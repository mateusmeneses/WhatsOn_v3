import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type DashboardPeriod = "today" | "yesterday" | "7d" | "30d" | "90d" | "custom";

export interface DashboardParams {
  period: DashboardPeriod;
  from?: string;
  to?: string;
}

export interface Metric {
  value: number;
  previous: number;
}

/** Em segundos; null quando não houve amostra no período. */
export interface DurationMetric {
  value: number | null;
  previous: number | null;
}

export interface DashboardAgent {
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
}

export interface DashboardData {
  range: { from: string; to: string; days: number; timezone: string; generatedAt: string };
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
    responseWithinSla: DurationMetric;
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
  agents: DashboardAgent[];
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

export const dashboardKeys = { all: ["dashboard"] as const, params: (p: DashboardParams) => ["dashboard", p] as const };

export async function fetchDashboard(params: DashboardParams): Promise<DashboardData> {
  const { data } = await api.get<DashboardData>("/dashboard", {
    params: params.period === "custom" ? params : { period: params.period },
  });
  return data;
}

export const DASHBOARD_REFRESH_MS = 30_000;

export function useDashboard(params: DashboardParams, enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.params(params),
    queryFn: () => fetchDashboard(params),
    enabled,
    refetchInterval: DASHBOARD_REFRESH_MS,
    placeholderData: keepPreviousData,
  });
}

/** Desempenho do próprio usuário (qualquer perfil). */
export interface MyPerformance {
  range: { from: string; to: string; days: number; timezone: string; generatedAt: string };
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

export const performanceKeys = { all: ["performance"] as const, params: (p: DashboardParams) => ["performance", p] as const };

export async function fetchMyPerformance(params: DashboardParams): Promise<MyPerformance> {
  const { data } = await api.get<MyPerformance>("/dashboard/me", {
    params: params.period === "custom" ? params : { period: params.period },
  });
  return data;
}

export function useMyPerformance(params: DashboardParams) {
  return useQuery({
    queryKey: performanceKeys.params(params),
    queryFn: () => fetchMyPerformance(params),
    refetchInterval: DASHBOARD_REFRESH_MS,
    placeholderData: keepPreviousData,
  });
}
