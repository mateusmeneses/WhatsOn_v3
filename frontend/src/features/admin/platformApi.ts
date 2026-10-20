import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DashboardParams, Metric } from "@/features/dashboard/dashboardApi";

export interface PlatformOverview {
  range: { from: string; to: string; days: number; timezone: string; generatedAt: string };
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
    newCompanies: Metric;
    ticketsCreated: Metric;
    ticketsClosed: Metric;
    messagesIn: Metric;
    messagesOut: Metric;
    activeCompaniesWithTraffic: Metric;
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

export const platformKeys = { overview: (p: DashboardParams) => ["admin", "overview", p] as const };

export async function fetchPlatformOverview(params: DashboardParams): Promise<PlatformOverview> {
  const { data } = await api.get<PlatformOverview>("/admin/overview", {
    params: params.period === "custom" ? params : { period: params.period },
  });
  return data;
}

export function usePlatformOverview(params: DashboardParams) {
  return useQuery({
    queryKey: platformKeys.overview(params),
    queryFn: () => fetchPlatformOverview(params),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}
