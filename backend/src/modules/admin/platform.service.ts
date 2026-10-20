import { dayList, num, resolveRange, sqlRows, type DashboardPeriod, type DashboardRange } from "../dashboard/dashboard.service";
import { onlineCountsByCompany } from "../realtime/socket";
import { QueryTypes } from "sequelize";
import { sequelize } from "../../database/sequelize";

/** A plataforma não pertence a uma empresa: os dias são agrupados neste fuso. */
export const PLATFORM_TIMEZONE = "America/Sao_Paulo";

export interface PlatformMetric {
  value: number;
  previous: number;
}

export interface PlatformOverview {
  range: DashboardRange & { timezone: string; generatedAt: string };
  totals: {
    companies: number;
    activeCompanies: number;
    blockedCompanies: number;
    users: number;
    onlineUsers: number;
    partners: number;
    connections: { connected: number; qrcode: number; disconnected: number };
  };
  kpis: {
    newCompanies: PlatformMetric;
    ticketsCreated: PlatformMetric;
    ticketsClosed: PlatformMetric;
    messagesIn: PlatformMetric;
    messagesOut: PlatformMetric;
    /** Empresas ativas com pelo menos uma mensagem no período. */
    activeCompaniesWithTraffic: PlatformMetric;
  };
  timeline: { date: string; tickets: number; messages: number; newCompanies: number }[];
  companies: {
    id: number;
    name: string;
    status: string;
    partner: string | null;
    createdAt: string;
    users: number;
    onlineUsers: number;
    connectionsConnected: number;
    connections: number;
    tickets: number;
    messages: number;
    lastActivityAt: string | null;
  }[];
  partners: { id: number; name: string; status: string; companies: number; tickets: number; lastUsedAt: string | null }[];
}

const iso = (v: unknown) => (v ? new Date(v as string | Date).toISOString() : null);

/** Visão geral da plataforma para o super-admin (todas as empresas). */
export async function getPlatformOverview(period: DashboardPeriod, custom?: { from?: string; to?: string }): Promise<PlatformOverview> {
  const range = resolveRange(period, PLATFORM_TIMEZONE, custom);
  const [b] = await sequelize.query<{ start: Date; end: Date; prevStart: Date }>(
    `SELECT (CAST(:from AS date))::timestamp AT TIME ZONE :tz AS "start",
            (CAST(:to AS date) + 1)::timestamp AT TIME ZONE :tz AS "end",
            (CAST(:from AS date) - CAST(:days AS int))::timestamp AT TIME ZONE :tz AS "prevStart"`,
    { type: QueryTypes.SELECT, replacements: { from: range.from, to: range.to, days: range.days, tz: PLATFORM_TIMEZONE } },
  );
  const r = { tz: PLATFORM_TIMEZONE, ...b! };
  const q = (sql: string) => sqlRows(sql, r);

  const [companyTotals, userTotals, partnerTotals, connTotals, newCo, ticketKpi, messageKpi, trafficKpi, ticketDay, messageDay, companyDay, companyRows, partnerRows, online] =
    await Promise.all([
      q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'blocked')::int AS blocked FROM companies`),
      q(`SELECT count(*)::int AS total FROM users WHERE profile <> 'superadmin'`),
      q(`SELECT count(*) FILTER (WHERE status = 'active')::int AS active FROM partners`),
      q(`SELECT status, count(*)::int AS count FROM connections GROUP BY status`),
      q(`SELECT count(*) FILTER (WHERE "createdAt" >= :start AND "createdAt" < :end)::int AS "current",
                count(*) FILTER (WHERE "createdAt" >= :prevStart AND "createdAt" < :start)::int AS previous
         FROM companies`),
      q(`SELECT count(*) FILTER (WHERE "createdAt" >= :start AND "createdAt" < :end)::int AS created,
                count(*) FILTER (WHERE "createdAt" >= :prevStart AND "createdAt" < :start)::int AS "prevCreated",
                count(*) FILTER (WHERE "closedAt" >= :start AND "closedAt" < :end)::int AS closed,
                count(*) FILTER (WHERE "closedAt" >= :prevStart AND "closedAt" < :start)::int AS "prevClosed"
         FROM tickets WHERE "createdAt" >= :prevStart OR "closedAt" >= :prevStart`),
      q(`SELECT count(*) FILTER (WHERE NOT "fromMe" AND "createdAt" >= :start)::int AS "in",
                count(*) FILTER (WHERE NOT "fromMe" AND "createdAt" < :start)::int AS "prevIn",
                count(*) FILTER (WHERE "fromMe" AND "createdAt" >= :start)::int AS "out",
                count(*) FILTER (WHERE "fromMe" AND "createdAt" < :start)::int AS "prevOut"
         FROM messages WHERE "createdAt" >= :prevStart AND "createdAt" < :end`),
      q(`SELECT count(DISTINCT m."companyId") FILTER (WHERE m."createdAt" >= :start)::int AS "current",
                count(DISTINCT m."companyId") FILTER (WHERE m."createdAt" < :start)::int AS previous
         FROM messages m JOIN companies c ON c.id = m."companyId" AND c.status = 'active'
         WHERE m."createdAt" >= :prevStart AND m."createdAt" < :end`),
      q(`SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE :tz), 'YYYY-MM-DD') AS date, count(*)::int AS count
         FROM tickets WHERE "createdAt" >= :start AND "createdAt" < :end GROUP BY 1`),
      q(`SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE :tz), 'YYYY-MM-DD') AS date, count(*)::int AS count
         FROM messages WHERE "createdAt" >= :start AND "createdAt" < :end GROUP BY 1`),
      q(`SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE :tz), 'YYYY-MM-DD') AS date, count(*)::int AS count
         FROM companies WHERE "createdAt" >= :start AND "createdAt" < :end GROUP BY 1`),
      q(`SELECT c.id, c.name, c.status, c."createdAt", p.name AS partner,
                (SELECT count(*) FROM users u WHERE u."companyId" = c.id)::int AS users,
                (SELECT count(*) FROM connections n WHERE n."companyId" = c.id)::int AS connections,
                (SELECT count(*) FROM connections n WHERE n."companyId" = c.id AND n.status = 'connected')::int AS "connectionsConnected",
                (SELECT count(*) FROM tickets t WHERE t."companyId" = c.id AND t."createdAt" >= :start AND t."createdAt" < :end)::int AS tickets,
                (SELECT count(*) FROM messages m WHERE m."companyId" = c.id AND m."createdAt" >= :start AND m."createdAt" < :end)::int AS messages,
                (SELECT max(m."createdAt") FROM messages m WHERE m."companyId" = c.id) AS "lastActivityAt"
         FROM companies c LEFT JOIN partners p ON p.id = c."partnerId"
         ORDER BY messages DESC, c.name`),
      q(`SELECT p.id, p.name, p.status, p."lastUsedAt",
                (SELECT count(*) FROM companies c WHERE c."partnerId" = p.id)::int AS companies,
                (SELECT count(*) FROM tickets t JOIN companies c ON c.id = t."companyId"
                   WHERE c."partnerId" = p.id AND t."createdAt" >= :start AND t."createdAt" < :end)::int AS tickets
         FROM partners p ORDER BY tickets DESC, p.name`),
      onlineCountsByCompany(),
    ]);

  const days = dayList(range.from, range.to);
  const tl = new Map(days.map((d) => [d, { date: d, tickets: 0, messages: 0, newCompanies: 0 }]));
  for (const [rows, key] of [[ticketDay, "tickets"], [messageDay, "messages"], [companyDay, "newCompanies"]] as const) {
    for (const row of rows) {
      const slot = tl.get(String(row.date));
      if (slot) slot[key] = num(row.count);
    }
  }

  const conn = (status: string) => num(connTotals.find((x) => x.status === status)?.count);
  const t0 = ticketKpi[0] ?? {};
  const m0 = messageKpi[0] ?? {};
  const totalCompanies = num(companyTotals[0]?.total);
  const blocked = num(companyTotals[0]?.blocked);
  const onlineTotal = [...online.values()].reduce((a, b) => a + b, 0);

  return {
    range: { ...range, timezone: PLATFORM_TIMEZONE, generatedAt: new Date().toISOString() },
    totals: {
      companies: totalCompanies,
      activeCompanies: totalCompanies - blocked,
      blockedCompanies: blocked,
      users: num(userTotals[0]?.total),
      onlineUsers: onlineTotal,
      partners: num(partnerTotals[0]?.active),
      connections: { connected: conn("connected"), qrcode: conn("qrcode"), disconnected: conn("disconnected") },
    },
    kpis: {
      newCompanies: { value: num(newCo[0]?.current), previous: num(newCo[0]?.previous) },
      ticketsCreated: { value: num(t0.created), previous: num(t0.prevCreated) },
      ticketsClosed: { value: num(t0.closed), previous: num(t0.prevClosed) },
      messagesIn: { value: num(m0.in), previous: num(m0.prevIn) },
      messagesOut: { value: num(m0.out), previous: num(m0.prevOut) },
      activeCompaniesWithTraffic: { value: num(trafficKpi[0]?.current), previous: num(trafficKpi[0]?.previous) },
    },
    timeline: [...tl.values()],
    companies: companyRows.map((c) => ({
      id: num(c.id),
      name: String(c.name),
      status: String(c.status),
      partner: (c.partner as string | null) ?? null,
      createdAt: iso(c.createdAt)!,
      users: num(c.users),
      onlineUsers: online.get(num(c.id)) ?? 0,
      connectionsConnected: num(c.connectionsConnected),
      connections: num(c.connections),
      tickets: num(c.tickets),
      messages: num(c.messages),
      lastActivityAt: iso(c.lastActivityAt),
    })),
    partners: partnerRows.map((p) => ({
      id: num(p.id),
      name: String(p.name),
      status: String(p.status),
      companies: num(p.companies),
      tickets: num(p.tickets),
      lastUsedAt: iso(p.lastUsedAt),
    })),
  };
}

