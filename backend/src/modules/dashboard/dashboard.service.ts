import { QueryTypes } from "sequelize";
import { sequelize } from "../../database/sequelize";
import { Company } from "../../models";
import { notFound } from "../../shared/errors/AppError";
import { onlineUsers } from "../realtime/socket";

export type DashboardPeriod = "today" | "yesterday" | "7d" | "30d" | "90d" | "custom";

export interface DashboardRange {
  /** Datas locais (fuso da empresa) no formato YYYY-MM-DD, ambas inclusivas. */
  from: string;
  to: string;
  days: number;
}

/** Respondida dentro desta meta conta como "no prazo". */
export const RESPONSE_SLA_SECONDS = 5 * 60;
export const MAX_RANGE_DAYS = 366;

const DAY_MS = 86_400_000;
const dayToMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const msToDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Data de hoje no fuso informado. */
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function resolveRange(
  period: DashboardPeriod,
  timezone: string,
  custom?: { from?: string; to?: string },
  now = new Date(),
): DashboardRange {
  const today = todayIn(timezone, now);
  let from = today;
  let to = today;
  if (period === "yesterday") {
    from = to = msToDay(dayToMs(today) - DAY_MS);
  } else if (period === "7d" || period === "30d" || period === "90d") {
    const span = Number.parseInt(period, 10);
    from = msToDay(dayToMs(today) - (span - 1) * DAY_MS);
  } else if (period === "custom" && custom?.from && custom?.to) {
    from = custom.from;
    to = custom.to;
  }
  if (to < from) [from, to] = [to, from];
  const days = Math.round((dayToMs(to) - dayToMs(from)) / DAY_MS) + 1;
  return { from, to, days };
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export interface Metric {
  value: number;
  previous: number;
}
export interface DurationMetric {
  /** Em segundos; null quando não houve amostra no período. */
  value: number | null;
  previous: number | null;
}

export interface DashboardData {
  range: DashboardRange & { timezone: string; generatedAt: string };
  live: {
    bot: number;
    pending: number;
    open: number;
    closedToday: number;
    waitingReply: number;
    oldestPendingSince: string | null;
    onlineUsers: number;
  };
  kpis: {
    ticketsCreated: Metric;
    ticketsClosed: Metric;
    messagesIn: Metric;
    messagesOut: Metric;
    messagesBot: Metric;
    avgResolution: DurationMetric;
    medianResponse: DurationMetric;
    avgResponse: DurationMetric;
    avgAcceptWait: DurationMetric;
    responseWithinSla: { value: number | null; previous: number | null };
    slaSeconds: number;
  };
  timeline: { date: string; created: number; closed: number; inbound: number; outbound: number; bot: number }[];
  movementTimeline: { date: string; accepted: number; transferred: number; claimed: number; reopened: number }[];
  heatmap: { weekday: number; hour: number; count: number }[];
  movement: { accepted: number; transferred: number; claimed: number; reopened: number; botTimeout: number; closed: number };
  bot: { handled: number; resolvedByBot: number; timeouts: number };
  byQueue: { id: number | null; name: string; color: string; created: number; closed: number; waiting: number; avgResolution: number | null }[];
  byConnection: { id: number; name: string; number: string | null; status: string; tickets: number; messagesIn: number }[];
  messageTypes: { type: string; count: number }[];
  agents: {
    id: number;
    name: string;
    profile: string;
    online: boolean;
    connectedSince: string | null;
    lastLoginAt: string | null;
    lastSeenAt: string | null;
    openNow: number;
    accepted: number;
    closed: number;
    messagesSent: number;
    avgResponse: number | null;
    avgAcceptWait: number | null;
  }[];
  topContacts: { id: number; name: string; number: string; tickets: number; inbound: number; outbound: number; lastAt: string }[];
  slowestResponses: {
    messageId: number;
    ticketId: number;
    contactName: string;
    agentName: string | null;
    queueName: string | null;
    askedAt: string;
    answeredAt: string;
    seconds: number;
  }[];
  waitingNow: {
    ticketId: number;
    contactName: string;
    status: string;
    agentName: string | null;
    queueName: string | null;
    queueColor: string | null;
    since: string;
  }[];
  recentActivity: {
    id: number;
    event: string;
    createdAt: string;
    ticketId: number;
    contactName: string;
    userName: string | null;
    toUserName: string | null;
    queueName: string | null;
  }[];
}

type Row = Record<string, unknown>;

/** Mensagem do cliente que abre uma "rodada" (a anterior foi nossa ou não existe) e a próxima resposta enviada. */
const ASKS_CTE = `
  seq AS (
    SELECT id, "ticketId", "fromMe", "createdAt",
           LAG("fromMe") OVER (PARTITION BY "ticketId" ORDER BY "createdAt", id) AS "prevFromMe"
    FROM messages
    WHERE "companyId" = :companyId AND "createdAt" >= CAST(:prevStart AS timestamptz) - interval '1 day' AND "createdAt" < :end
  ),
  asks AS (
    SELECT s.id, s."ticketId", s."createdAt" AS "askedAt",
           nx."createdAt" AS "answeredAt", nx."isBot" AS "botReply", nx."sentByUserId" AS "userId"
    FROM seq s
    LEFT JOIN LATERAL (
      SELECT o."createdAt", o."isBot", o."sentByUserId" FROM messages o
      WHERE o."ticketId" = s."ticketId" AND o."fromMe" AND (o."createdAt", o.id) > (s."createdAt", s.id)
      ORDER BY o."createdAt", o.id LIMIT 1
    ) nx ON true
    WHERE NOT s."fromMe" AND s."prevFromMe" IS NOT FALSE AND s."createdAt" >= :prevStart
  ),
  answered AS (
    SELECT *, EXTRACT(EPOCH FROM ("answeredAt" - "askedAt")) AS secs
    FROM asks WHERE "answeredAt" IS NOT NULL AND NOT "botReply"
  )`;

/** Tempo entre o chamado ficar aguardando (criado/transferido/reaberto) e um atendente aceitá-lo. */
const ACCEPTS_CTE = `
  accepts AS (
    SELECT a.id, a."userId", a."createdAt",
           EXTRACT(EPOCH FROM (a."createdAt" - p."createdAt")) AS secs
    FROM ticket_logs a
    JOIN LATERAL (
      SELECT l."createdAt" FROM ticket_logs l
      WHERE l."ticketId" = a."ticketId" AND l.event IN ('created', 'transferred', 'reopened')
        AND (l."createdAt", l.id) < (a."createdAt", a.id)
      ORDER BY l."createdAt" DESC, l.id DESC LIMIT 1
    ) p ON true
    WHERE a."companyId" = :companyId AND a.event = 'accepted' AND a."userId" IS NOT NULL
      AND a."createdAt" >= :prevStart AND a."createdAt" < :end
  )`;

function fillDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let ms = dayToMs(from); ms <= dayToMs(to); ms += DAY_MS) out.push(msToDay(ms));
  return out;
}

export async function getDashboard(companyId: number, range: DashboardRange): Promise<DashboardData> {
  const company = await Company.findByPk(companyId, { attributes: ["id", "timezone"] });
  if (!company) throw notFound("Empresa");
  const tz = company.timezone;

  const prevFrom = msToDay(dayToMs(range.from) - range.days * DAY_MS);
  const [bounds] = await sequelize.query<{ start: Date; end: Date; prevStart: Date; todayStart: Date; todayEnd: Date }>(
    `SELECT (CAST(:from AS date))::timestamp AT TIME ZONE :tz AS "start",
            (CAST(:to AS date) + 1)::timestamp AT TIME ZONE :tz AS "end",
            (CAST(:prevFrom AS date))::timestamp AT TIME ZONE :tz AS "prevStart",
            (CAST(:today AS date))::timestamp AT TIME ZONE :tz AS "todayStart",
            (CAST(:today AS date) + 1)::timestamp AT TIME ZONE :tz AS "todayEnd"`,
    { type: QueryTypes.SELECT, replacements: { from: range.from, to: range.to, prevFrom, tz, today: todayIn(tz) } },
  );
  const r = {
    companyId,
    tz,
    start: bounds.start,
    end: bounds.end,
    prevStart: bounds.prevStart,
    todayStart: bounds.todayStart,
    todayEnd: bounds.todayEnd,
  };
  const q = <T extends Row = Row>(sql: string) => sequelize.query<T>(sql, { type: QueryTypes.SELECT, replacements: r });

  const [
    ticketKpi,
    liveStatus,
    messageKpi,
    ticketsByDay,
    messagesByDay,
    eventsByDay,
    heatmapRows,
    eventTotals,
    botRows,
    queueRows,
    connectionRows,
    typeRows,
    userRows,
    agentTickets,
    agentEvents,
    agentMessages,
    responseKpi,
    responseByAgent,
    acceptKpi,
    acceptByAgent,
    contactRows,
    slowRows,
    waitingRows,
    waitingCount,
    activityRows,
    online,
  ] = await Promise.all([
    q(`SELECT
         count(*) FILTER (WHERE "createdAt" >= :start AND "createdAt" < :end)::int AS created,
         count(*) FILTER (WHERE "createdAt" >= :prevStart AND "createdAt" < :start)::int AS "prevCreated",
         count(*) FILTER (WHERE "closedAt" >= :start AND "closedAt" < :end)::int AS closed,
         count(*) FILTER (WHERE "closedAt" >= :prevStart AND "closedAt" < :start)::int AS "prevClosed",
         avg(EXTRACT(EPOCH FROM ("closedAt" - "createdAt"))) FILTER (WHERE "closedAt" >= :start AND "closedAt" < :end) AS resolution,
         avg(EXTRACT(EPOCH FROM ("closedAt" - "createdAt"))) FILTER (WHERE "closedAt" >= :prevStart AND "closedAt" < :start) AS "prevResolution"
       FROM tickets WHERE "companyId" = :companyId AND ("createdAt" >= :prevStart OR "closedAt" >= :prevStart)`),
    q(`SELECT status, count(*)::int AS count, min("createdAt") AS oldest,
              count(*) FILTER (WHERE status = 'closed' AND "closedAt" >= :todayStart AND "closedAt" < :todayEnd)::int AS "closedToday"
       FROM tickets WHERE "companyId" = :companyId
         AND (status <> 'closed' OR ("closedAt" >= :todayStart AND "closedAt" < :todayEnd))
       GROUP BY status`),
    q(`SELECT
         count(*) FILTER (WHERE NOT "fromMe" AND "createdAt" >= :start)::int AS "in",
         count(*) FILTER (WHERE NOT "fromMe" AND "createdAt" < :start)::int AS "prevIn",
         count(*) FILTER (WHERE "fromMe" AND NOT "isBot" AND "createdAt" >= :start)::int AS "out",
         count(*) FILTER (WHERE "fromMe" AND NOT "isBot" AND "createdAt" < :start)::int AS "prevOut",
         count(*) FILTER (WHERE "isBot" AND "createdAt" >= :start)::int AS bot,
         count(*) FILTER (WHERE "isBot" AND "createdAt" < :start)::int AS "prevBot"
       FROM messages WHERE "companyId" = :companyId AND "createdAt" >= :prevStart AND "createdAt" < :end`),
    q(`SELECT to_char(day, 'YYYY-MM-DD') AS date, kind, count(*)::int AS count FROM (
         SELECT date_trunc('day', "createdAt" AT TIME ZONE :tz) AS day, 'created' AS kind FROM tickets
           WHERE "companyId" = :companyId AND "createdAt" >= :start AND "createdAt" < :end
         UNION ALL
         SELECT date_trunc('day', "closedAt" AT TIME ZONE :tz), 'closed' FROM tickets
           WHERE "companyId" = :companyId AND "closedAt" >= :start AND "closedAt" < :end
       ) t GROUP BY 1, 2`),
    q(`SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE :tz), 'YYYY-MM-DD') AS date,
              count(*) FILTER (WHERE NOT "fromMe")::int AS inbound,
              count(*) FILTER (WHERE "fromMe" AND NOT "isBot")::int AS outbound,
              count(*) FILTER (WHERE "isBot")::int AS bot
       FROM messages WHERE "companyId" = :companyId AND "createdAt" >= :start AND "createdAt" < :end GROUP BY 1`),
    q(`SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE :tz), 'YYYY-MM-DD') AS date, event, count(*)::int AS count
       FROM ticket_logs WHERE "companyId" = :companyId AND "createdAt" >= :start AND "createdAt" < :end GROUP BY 1, 2`),
    q(`SELECT EXTRACT(DOW FROM ("createdAt" AT TIME ZONE :tz))::int AS weekday,
              EXTRACT(HOUR FROM ("createdAt" AT TIME ZONE :tz))::int AS hour, count(*)::int AS count
       FROM messages WHERE "companyId" = :companyId AND NOT "fromMe" AND "createdAt" >= :start AND "createdAt" < :end GROUP BY 1, 2`),
    q(`SELECT event, count(*)::int AS count FROM ticket_logs
       WHERE "companyId" = :companyId AND "createdAt" >= :start AND "createdAt" < :end GROUP BY event`),
    q(`SELECT count(*)::int AS handled,
              count(*) FILTER (WHERE t.status = 'closed' AND NOT EXISTS (
                SELECT 1 FROM ticket_logs l WHERE l."ticketId" = t.id AND l.event IN ('accepted', 'claimed', 'reopened')
              ))::int AS "resolvedByBot"
       FROM tickets t WHERE t."companyId" = :companyId AND t."createdAt" >= :start AND t."createdAt" < :end
         AND EXISTS (SELECT 1 FROM messages m WHERE m."ticketId" = t.id AND m."isBot")`),
    q(`SELECT qu.id, COALESCE(qu.name, 'Sem fila') AS name, COALESCE(qu.color, '#94a3b8') AS color,
              count(*) FILTER (WHERE t."createdAt" >= :start AND t."createdAt" < :end)::int AS created,
              count(*) FILTER (WHERE t."closedAt" >= :start AND t."closedAt" < :end)::int AS closed,
              count(*) FILTER (WHERE t.status = 'pending')::int AS waiting,
              avg(EXTRACT(EPOCH FROM (t."closedAt" - t."createdAt"))) FILTER (WHERE t."closedAt" >= :start AND t."closedAt" < :end) AS resolution
       FROM tickets t LEFT JOIN queues qu ON qu.id = t."queueId"
       WHERE t."companyId" = :companyId
         AND ((t."createdAt" >= :start AND t."createdAt" < :end) OR (t."closedAt" >= :start AND t."closedAt" < :end) OR t.status = 'pending')
       GROUP BY qu.id, qu.name, qu.color ORDER BY created DESC`),
    q(`SELECT c.id, c.name, c.number, c.status,
              count(DISTINCT t.id) FILTER (WHERE t."createdAt" >= :start AND t."createdAt" < :end)::int AS tickets,
              (SELECT count(*) FROM messages m WHERE m."connectionId" = c.id AND NOT m."fromMe"
                 AND m."createdAt" >= :start AND m."createdAt" < :end)::int AS "messagesIn"
       FROM connections c LEFT JOIN tickets t ON t."connectionId" = c.id
       WHERE c."companyId" = :companyId GROUP BY c.id ORDER BY tickets DESC, c.name`),
    q(`SELECT type, count(*)::int AS count FROM messages
       WHERE "companyId" = :companyId AND "createdAt" >= :start AND "createdAt" < :end GROUP BY type ORDER BY count DESC`),
    q(`SELECT id, name, profile, "lastLoginAt", "lastSeenAt" FROM users
       WHERE "companyId" = :companyId AND profile <> 'superadmin' ORDER BY name`),
    q(`SELECT "userId", count(*)::int AS "openNow" FROM tickets
       WHERE "companyId" = :companyId AND status = 'open' AND "userId" IS NOT NULL GROUP BY "userId"`),
    q(`SELECT "userId", event, count(*)::int AS count FROM ticket_logs
       WHERE "companyId" = :companyId AND "userId" IS NOT NULL AND event IN ('accepted', 'closed')
         AND "createdAt" >= :start AND "createdAt" < :end GROUP BY 1, 2`),
    q(`SELECT "sentByUserId" AS "userId", count(*)::int AS count FROM messages
       WHERE "companyId" = :companyId AND "sentByUserId" IS NOT NULL AND "createdAt" >= :start AND "createdAt" < :end GROUP BY 1`),
    q(`WITH ${ASKS_CTE}
       SELECT
         count(*) FILTER (WHERE "askedAt" >= :start)::int AS count,
         avg(secs) FILTER (WHERE "askedAt" >= :start) AS avg,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY secs) FILTER (WHERE "askedAt" >= :start) AS median,
         count(*) FILTER (WHERE "askedAt" >= :start AND secs <= ${RESPONSE_SLA_SECONDS})::int AS "inSla",
         count(*) FILTER (WHERE "askedAt" < :start)::int AS "prevCount",
         avg(secs) FILTER (WHERE "askedAt" < :start) AS "prevAvg",
         percentile_cont(0.5) WITHIN GROUP (ORDER BY secs) FILTER (WHERE "askedAt" < :start) AS "prevMedian",
         count(*) FILTER (WHERE "askedAt" < :start AND secs <= ${RESPONSE_SLA_SECONDS})::int AS "prevInSla"
       FROM answered`),
    q(`WITH ${ASKS_CTE}
       SELECT "userId", avg(secs) AS avg FROM answered
       WHERE "askedAt" >= :start AND "userId" IS NOT NULL GROUP BY "userId"`),
    q(`WITH ${ACCEPTS_CTE}
       SELECT avg(secs) FILTER (WHERE "createdAt" >= :start) AS avg,
              avg(secs) FILTER (WHERE "createdAt" < :start) AS "prevAvg" FROM accepts`),
    q(`WITH ${ACCEPTS_CTE}
       SELECT "userId", avg(secs) AS avg FROM accepts WHERE "createdAt" >= :start GROUP BY "userId"`),
    q(`SELECT c.id, c.name, c.number,
              count(DISTINCT m."ticketId")::int AS tickets,
              count(*) FILTER (WHERE NOT m."fromMe")::int AS inbound,
              count(*) FILTER (WHERE m."fromMe")::int AS outbound,
              max(m."createdAt") AS "lastAt"
       FROM messages m JOIN tickets t ON t.id = m."ticketId" JOIN contacts c ON c.id = t."contactId"
       WHERE m."companyId" = :companyId AND m."createdAt" >= :start AND m."createdAt" < :end
       GROUP BY c.id ORDER BY count(*) DESC LIMIT 8`),
    q(`WITH ${ASKS_CTE}
       SELECT a.id AS "messageId", a."ticketId", c.name AS "contactName", u.name AS "agentName", qu.name AS "queueName",
              a."askedAt", a."answeredAt", a.secs AS seconds
       FROM answered a
       JOIN tickets t ON t.id = a."ticketId" JOIN contacts c ON c.id = t."contactId"
       LEFT JOIN users u ON u.id = a."userId" LEFT JOIN queues qu ON qu.id = t."queueId"
       WHERE a."askedAt" >= :start ORDER BY a.secs DESC LIMIT 10`),
    q(`SELECT * FROM (
         SELECT t.id AS "ticketId", c.name AS "contactName", t.status, u.name AS "agentName", qu.name AS "queueName", qu.color AS "queueColor",
                (SELECT min(m."createdAt") FROM messages m WHERE m."ticketId" = t.id AND NOT m."fromMe"
                   AND m."createdAt" > COALESCE((SELECT max(o."createdAt") FROM messages o WHERE o."ticketId" = t.id AND o."fromMe"), '-infinity')) AS since
         FROM tickets t JOIN contacts c ON c.id = t."contactId"
         LEFT JOIN users u ON u.id = t."userId" LEFT JOIN queues qu ON qu.id = t."queueId"
         WHERE t."companyId" = :companyId AND t.status IN ('pending', 'open')
       ) w WHERE since IS NOT NULL ORDER BY since LIMIT 8`),
    q(`SELECT count(*)::int AS count FROM tickets t
       WHERE t."companyId" = :companyId AND t.status IN ('pending', 'open') AND EXISTS (
         SELECT 1 FROM messages m WHERE m."ticketId" = t.id AND NOT m."fromMe"
           AND m."createdAt" > COALESCE((SELECT max(o."createdAt") FROM messages o WHERE o."ticketId" = t.id AND o."fromMe"), '-infinity'))`),
    q(`SELECT l.id, l.event, l."createdAt", l."ticketId", c.name AS "contactName", u.name AS "userName",
              tu.name AS "toUserName", qu.name AS "queueName"
       FROM ticket_logs l JOIN tickets t ON t.id = l."ticketId" JOIN contacts c ON c.id = t."contactId"
       LEFT JOIN users u ON u.id = l."userId" LEFT JOIN users tu ON tu.id = l."toUserId"
       LEFT JOIN queues qu ON qu.id = l."toQueueId"
       WHERE l."companyId" = :companyId ORDER BY l."createdAt" DESC, l.id DESC LIMIT 12`),
    onlineUsers(companyId),
  ]);

  const t0 = ticketKpi[0] ?? {};
  const m0 = messageKpi[0] ?? {};
  const rk = responseKpi[0] ?? {};
  const ak = acceptKpi[0] ?? {};

  const statusCount = (s: string) => num(liveStatus.find((x) => x.status === s)?.count);
  const pendingOldest = liveStatus.find((x) => x.status === "pending")?.oldest as Date | undefined;

  const days = fillDays(range.from, range.to);
  const tl = new Map(days.map((d) => [d, { date: d, created: 0, closed: 0, inbound: 0, outbound: 0, bot: 0 }]));
  for (const row of ticketsByDay) {
    const slot = tl.get(String(row.date));
    if (slot) slot[row.kind as "created" | "closed"] = num(row.count);
  }
  for (const row of messagesByDay) {
    const slot = tl.get(String(row.date));
    if (slot) Object.assign(slot, { inbound: num(row.inbound), outbound: num(row.outbound), bot: num(row.bot) });
  }
  const mv = new Map(days.map((d) => [d, { date: d, accepted: 0, transferred: 0, claimed: 0, reopened: 0 }]));
  for (const row of eventsByDay) {
    const slot = mv.get(String(row.date));
    const key = String(row.event);
    if (slot && (key === "accepted" || key === "transferred" || key === "claimed" || key === "reopened")) slot[key] = num(row.count);
  }

  const evt = (name: string) => num(eventTotals.find((x) => x.event === name)?.count);
  const onlineById = new Map(online.map((o) => [o.userId, o]));
  const mapBy = (rows: Row[], key: string, field: string) =>
    new Map(rows.map((row) => [num(row[key]), row[field] as unknown]));
  const openNow = mapBy(agentTickets, "userId", "openNow");
  const msgs = mapBy(agentMessages, "userId", "count");
  const respAvg = mapBy(responseByAgent, "userId", "avg");
  const acceptAvg = mapBy(acceptByAgent, "userId", "avg");
  const evtFor = (userId: number, event: string) =>
    num(agentEvents.find((x) => num(x.userId) === userId && x.event === event)?.count);
  const iso = (v: unknown) => (v ? new Date(v as string | Date).toISOString() : null);

  const agents = userRows
    .map((u) => {
      const id = num(u.id);
      const presence = onlineById.get(id);
      return {
        id,
        name: String(u.name),
        profile: String(u.profile),
        online: Boolean(presence),
        connectedSince: presence ? new Date(presence.connectedSince).toISOString() : null,
        lastLoginAt: iso(u.lastLoginAt),
        lastSeenAt: iso(u.lastSeenAt),
        openNow: num(openNow.get(id)),
        accepted: evtFor(id, "accepted"),
        closed: evtFor(id, "closed"),
        messagesSent: num(msgs.get(id)),
        avgResponse: numOrNull(respAvg.get(id)),
        avgAcceptWait: numOrNull(acceptAvg.get(id)),
      };
    })
    .sort(
      (a, b) =>
        Number(b.online) - Number(a.online) || b.closed + b.messagesSent - (a.closed + a.messagesSent) || a.name.localeCompare(b.name),
    );

  const pct = (part: unknown, total: unknown) => (num(total) > 0 ? (num(part) / num(total)) * 100 : null);

  return {
    range: { ...range, timezone: tz, generatedAt: new Date().toISOString() },
    live: {
      bot: statusCount("bot"),
      pending: statusCount("pending"),
      open: statusCount("open"),
      closedToday: num(liveStatus.find((x) => x.status === "closed")?.closedToday),
      waitingReply: num(waitingCount[0]?.count),
      oldestPendingSince: pendingOldest ? new Date(pendingOldest).toISOString() : null,
      onlineUsers: online.length,
    },
    kpis: {
      ticketsCreated: { value: num(t0.created), previous: num(t0.prevCreated) },
      ticketsClosed: { value: num(t0.closed), previous: num(t0.prevClosed) },
      messagesIn: { value: num(m0.in), previous: num(m0.prevIn) },
      messagesOut: { value: num(m0.out), previous: num(m0.prevOut) },
      messagesBot: { value: num(m0.bot), previous: num(m0.prevBot) },
      avgResolution: { value: numOrNull(t0.resolution), previous: numOrNull(t0.prevResolution) },
      medianResponse: { value: numOrNull(rk.median), previous: numOrNull(rk.prevMedian) },
      avgResponse: { value: numOrNull(rk.avg), previous: numOrNull(rk.prevAvg) },
      avgAcceptWait: { value: numOrNull(ak.avg), previous: numOrNull(ak.prevAvg) },
      responseWithinSla: { value: pct(rk.inSla, rk.count), previous: pct(rk.prevInSla, rk.prevCount) },
      slaSeconds: RESPONSE_SLA_SECONDS,
    },
    timeline: [...tl.values()],
    movementTimeline: [...mv.values()],
    heatmap: heatmapRows.map((h) => ({ weekday: num(h.weekday), hour: num(h.hour), count: num(h.count) })),
    movement: {
      accepted: evt("accepted"),
      transferred: evt("transferred"),
      claimed: evt("claimed"),
      reopened: evt("reopened"),
      botTimeout: evt("bot_timeout"),
      closed: evt("closed"),
    },
    bot: {
      handled: num(botRows[0]?.handled),
      resolvedByBot: num(botRows[0]?.resolvedByBot),
      timeouts: evt("bot_timeout"),
    },
    byQueue: queueRows.map((x) => ({
      id: x.id === null ? null : num(x.id),
      name: String(x.name),
      color: String(x.color),
      created: num(x.created),
      closed: num(x.closed),
      waiting: num(x.waiting),
      avgResolution: numOrNull(x.resolution),
    })),
    byConnection: connectionRows.map((x) => ({
      id: num(x.id),
      name: String(x.name),
      number: (x.number as string | null) ?? null,
      status: String(x.status),
      tickets: num(x.tickets),
      messagesIn: num(x.messagesIn),
    })),
    messageTypes: typeRows.map((x) => ({ type: String(x.type), count: num(x.count) })),
    agents,
    topContacts: contactRows.map((x) => ({
      id: num(x.id),
      name: String(x.name),
      number: String(x.number),
      tickets: num(x.tickets),
      inbound: num(x.inbound),
      outbound: num(x.outbound),
      lastAt: iso(x.lastAt)!,
    })),
    slowestResponses: slowRows.map((x) => ({
      messageId: num(x.messageId),
      ticketId: num(x.ticketId),
      contactName: String(x.contactName),
      agentName: (x.agentName as string | null) ?? null,
      queueName: (x.queueName as string | null) ?? null,
      askedAt: iso(x.askedAt)!,
      answeredAt: iso(x.answeredAt)!,
      seconds: num(x.seconds),
    })),
    waitingNow: waitingRows.map((x) => ({
      ticketId: num(x.ticketId),
      contactName: String(x.contactName),
      status: String(x.status),
      agentName: (x.agentName as string | null) ?? null,
      queueName: (x.queueName as string | null) ?? null,
      queueColor: (x.queueColor as string | null) ?? null,
      since: iso(x.since)!,
    })),
    recentActivity: activityRows.map((x) => ({
      id: num(x.id),
      event: String(x.event),
      createdAt: iso(x.createdAt)!,
      ticketId: num(x.ticketId),
      contactName: String(x.contactName),
      userName: (x.userName as string | null) ?? null,
      toUserName: (x.toUserName as string | null) ?? null,
      queueName: (x.queueName as string | null) ?? null,
    })),
  };
}

export async function companyTimezone(companyId: number): Promise<string> {
  const company = await Company.findByPk(companyId, { attributes: ["timezone"] });
  if (!company) throw notFound("Empresa");
  return company.timezone;
}
