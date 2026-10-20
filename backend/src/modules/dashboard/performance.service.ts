import {
  ACCEPTS_CTE,
  ASKS_CTE,
  companySettings,
  computeBounds,
  dayList,
  num,
  numOrNull,
  type Row,
  sqlRows,
  type DashboardRange,
  type DurationMetric,
  type Metric,
} from "./dashboard.service";

export interface MyPerformance {
  range: DashboardRange & { timezone: string; generatedAt: string };
  live: { openNow: number; pendingForMe: number; waitingReply: number };
  kpis: {
    ticketsClosed: Metric;
    ticketsAccepted: Metric;
    messagesSent: Metric;
    medianResponse: DurationMetric;
    avgResponse: DurationMetric;
    avgAcceptWait: DurationMetric;
    avgResolution: DurationMetric;
    responseWithinSla: DurationMetric;
    slaSeconds: number;
  };
  /** Comparativo com a equipe no período (para o atendente se situar, sem expor colegas). */
  team: { medianResponse: number | null; avgClosedPerAgent: number | null; agents: number };
  timeline: { date: string; closed: number; accepted: number; messages: number }[];
  byQueue: { id: number | null; name: string; color: string; closed: number }[];
  slowestResponses: {
    messageId: number;
    ticketId: number;
    contactName: string;
    queueName: string | null;
    askedAt: string;
    answeredAt: string;
    seconds: number;
  }[];
  waitingNow: { ticketId: number; contactName: string; queueName: string | null; queueColor: string | null; since: string }[];
}

const iso = (v: unknown) => new Date(v as string | Date).toISOString();
const pct = (part: unknown, total: unknown) => (num(total) > 0 ? (num(part) / num(total)) * 100 : null);

/** Desempenho do próprio usuário logado (qualquer perfil). */
export async function getMyPerformance(companyId: number, userId: number, range: DashboardRange): Promise<MyPerformance> {
  const settings = await companySettings(companyId);
  const tz = settings.timezone;
  const r = { ...(await computeBounds(companyId, settings, range)), userId };
  const q = (sql: string) => sqlRows(sql, r);

  const [logs, sent, open, respStats, accept, byDay, sentByDay, queues, waiting, teamClosed, resolution] = await Promise.all([
    q(`SELECT
         count(*) FILTER (WHERE event = 'accepted' AND "createdAt" >= :start)::int AS accepted,
         count(*) FILTER (WHERE event = 'accepted' AND "createdAt" < :start)::int AS "prevAccepted",
         count(*) FILTER (WHERE event = 'closed' AND "createdAt" >= :start)::int AS closed,
         count(*) FILTER (WHERE event = 'closed' AND "createdAt" < :start)::int AS "prevClosed"
       FROM ticket_logs WHERE "companyId" = :companyId AND "userId" = :userId AND "createdAt" >= :prevStart AND "createdAt" < :end`),
    q(`SELECT count(*) FILTER (WHERE "createdAt" >= :start)::int AS count, count(*) FILTER (WHERE "createdAt" < :start)::int AS "prevCount"
       FROM messages WHERE "companyId" = :companyId AND "sentByUserId" = :userId AND "createdAt" >= :prevStart AND "createdAt" < :end`),
    q(`SELECT count(*) FILTER (WHERE status = 'open')::int AS "openNow", count(*) FILTER (WHERE status = 'pending')::int AS "pendingForMe"
       FROM tickets WHERE "companyId" = :companyId AND "userId" = :userId AND status IN ('open', 'pending')`),
    q(`WITH ${ASKS_CTE}
       SELECT
         (SELECT row_to_json(k) FROM (SELECT
            count(*) FILTER (WHERE "askedAt" >= :start)::int AS count,
            avg(secs) FILTER (WHERE "askedAt" >= :start) AS avg,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY secs) FILTER (WHERE "askedAt" >= :start) AS median,
            count(*) FILTER (WHERE "askedAt" >= :start AND secs <= :sla)::int AS "inSla",
            count(*) FILTER (WHERE "askedAt" < :start)::int AS "prevCount",
            avg(secs) FILTER (WHERE "askedAt" < :start) AS "prevAvg",
            percentile_cont(0.5) WITHIN GROUP (ORDER BY secs) FILTER (WHERE "askedAt" < :start) AS "prevMedian",
            count(*) FILTER (WHERE "askedAt" < :start AND secs <= :sla)::int AS "prevInSla"
          FROM answered WHERE "userId" = :userId) k) AS kpi,
         (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY secs) FROM answered
           WHERE "askedAt" >= :start AND "userId" IS NOT NULL) AS "teamMedian",
         (SELECT COALESCE(json_agg(w), '[]'::json) FROM (
            SELECT a.id AS "messageId", a."ticketId", c.name AS "contactName", qu.name AS "queueName", a."askedAt", a."answeredAt", a.secs AS seconds
            FROM answered a JOIN tickets t ON t.id = a."ticketId" JOIN contacts c ON c.id = t."contactId"
            LEFT JOIN queues qu ON qu.id = t."queueId"
            WHERE a."userId" = :userId AND a."askedAt" >= :start ORDER BY a.secs DESC LIMIT 5) w) AS slow`),
    q(`WITH ${ACCEPTS_CTE}
       SELECT avg(secs) FILTER (WHERE "createdAt" >= :start) AS avg, avg(secs) FILTER (WHERE "createdAt" < :start) AS "prevAvg"
       FROM accepts WHERE "userId" = :userId`),
    q(`SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE :tz), 'YYYY-MM-DD') AS date, event, count(*)::int AS count
       FROM ticket_logs WHERE "companyId" = :companyId AND "userId" = :userId AND event IN ('accepted', 'closed')
         AND "createdAt" >= :start AND "createdAt" < :end GROUP BY 1, 2`),
    q(`SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE :tz), 'YYYY-MM-DD') AS date, count(*)::int AS count
       FROM messages WHERE "companyId" = :companyId AND "sentByUserId" = :userId AND "createdAt" >= :start AND "createdAt" < :end GROUP BY 1`),
    q(`SELECT qu.id, COALESCE(qu.name, 'Sem fila') AS name, COALESCE(qu.color, '#94a3b8') AS color, count(*)::int AS closed
       FROM ticket_logs l JOIN tickets t ON t.id = l."ticketId" LEFT JOIN queues qu ON qu.id = t."queueId"
       WHERE l."companyId" = :companyId AND l."userId" = :userId AND l.event = 'closed' AND l."createdAt" >= :start AND l."createdAt" < :end
       GROUP BY qu.id, qu.name, qu.color ORDER BY closed DESC`),
    q(`SELECT * FROM (
         SELECT t.id AS "ticketId", c.name AS "contactName", qu.name AS "queueName", qu.color AS "queueColor",
                (SELECT min(m."createdAt") FROM messages m WHERE m."ticketId" = t.id AND NOT m."fromMe"
                   AND m."createdAt" > COALESCE((SELECT max(o."createdAt") FROM messages o WHERE o."ticketId" = t.id AND o."fromMe"), '-infinity')) AS since
         FROM tickets t JOIN contacts c ON c.id = t."contactId" LEFT JOIN queues qu ON qu.id = t."queueId"
         WHERE t."companyId" = :companyId AND t."userId" = :userId AND t.status IN ('pending', 'open')
       ) w WHERE since IS NOT NULL ORDER BY since LIMIT 10`),
    q(`SELECT count(*)::int AS total, count(DISTINCT "userId")::int AS agents FROM ticket_logs
       WHERE "companyId" = :companyId AND event = 'closed' AND "userId" IS NOT NULL AND "createdAt" >= :start AND "createdAt" < :end`),
    q(`SELECT avg(EXTRACT(EPOCH FROM (t."closedAt" - t."createdAt"))) AS "prevAvg"
       FROM tickets t WHERE t."companyId" = :companyId AND t."closedAt" >= :prevStart AND t."closedAt" < :start
         AND EXISTS (SELECT 1 FROM ticket_logs l WHERE l."ticketId" = t.id AND l.event = 'closed' AND l."userId" = :userId)`),
  ]);

  const resolutionCurrent = await q(
    `SELECT avg(EXTRACT(EPOCH FROM (t."closedAt" - t."createdAt"))) AS avg FROM tickets t
     WHERE t."companyId" = :companyId AND t."closedAt" >= :start AND t."closedAt" < :end
       AND EXISTS (SELECT 1 FROM ticket_logs l WHERE l."ticketId" = t.id AND l.event = 'closed' AND l."userId" = :userId)`,
  );

  const l0 = logs[0] ?? {};
  const s0 = sent[0] ?? {};
  const o0 = open[0] ?? {};
  const rs = (respStats[0] ?? {}) as { kpi?: Row; teamMedian?: unknown; slow?: Row[] };
  const r0 = rs.kpi ?? {};
  const slow = rs.slow ?? [];
  const a0 = accept[0] ?? {};
  const tc = teamClosed[0] ?? {};

  const days = dayList(range.from, range.to);
  const tl = new Map(days.map((d) => [d, { date: d, closed: 0, accepted: 0, messages: 0 }]));
  for (const row of byDay) {
    const slot = tl.get(String(row.date));
    if (slot) slot[row.event as "closed" | "accepted"] = num(row.count);
  }
  for (const row of sentByDay) {
    const slot = tl.get(String(row.date));
    if (slot) slot.messages = num(row.count);
  }

  return {
    range: { ...range, timezone: tz, generatedAt: new Date().toISOString() },
    live: { openNow: num(o0.openNow), pendingForMe: num(o0.pendingForMe), waitingReply: waiting.length },
    kpis: {
      ticketsClosed: { value: num(l0.closed), previous: num(l0.prevClosed) },
      ticketsAccepted: { value: num(l0.accepted), previous: num(l0.prevAccepted) },
      messagesSent: { value: num(s0.count), previous: num(s0.prevCount) },
      medianResponse: { value: numOrNull(r0.median), previous: numOrNull(r0.prevMedian) },
      avgResponse: { value: numOrNull(r0.avg), previous: numOrNull(r0.prevAvg) },
      avgAcceptWait: { value: numOrNull(a0.avg), previous: numOrNull(a0.prevAvg) },
      avgResolution: { value: numOrNull(resolutionCurrent[0]?.avg), previous: numOrNull(resolution[0]?.prevAvg) },
      responseWithinSla: { value: pct(r0.inSla, r0.count), previous: pct(r0.prevInSla, r0.prevCount) },
      slaSeconds: r.sla,
    },
    team: {
      medianResponse: numOrNull(rs.teamMedian),
      avgClosedPerAgent: num(tc.agents) > 0 ? num(tc.total) / num(tc.agents) : null,
      agents: num(tc.agents),
    },
    timeline: [...tl.values()],
    byQueue: queues.map((x) => ({ id: x.id === null ? null : num(x.id), name: String(x.name), color: String(x.color), closed: num(x.closed) })),
    slowestResponses: slow.map((x) => ({
      messageId: num(x.messageId),
      ticketId: num(x.ticketId),
      contactName: String(x.contactName),
      queueName: (x.queueName as string | null) ?? null,
      askedAt: iso(x.askedAt),
      answeredAt: iso(x.answeredAt),
      seconds: num(x.seconds),
    })),
    waitingNow: waiting.map((x) => ({
      ticketId: num(x.ticketId),
      contactName: String(x.contactName),
      queueName: (x.queueName as string | null) ?? null,
      queueColor: (x.queueColor as string | null) ?? null,
      since: iso(x.since),
    })),
  };
}
