import { api } from "@/lib/api";
import type { ScheduledMessage } from "@/types/api";

export const scheduledKeys = {
  ticket: (ticketId: number) => ["scheduled", ticketId] as const,
};

export async function fetchScheduled(ticketId: number): Promise<ScheduledMessage[]> {
  const { data } = await api.get<ScheduledMessage[]>(`/tickets/${ticketId}/scheduled`);
  return data;
}

export async function createScheduled(ticketId: number, body: { body: string; sendAt: string }): Promise<ScheduledMessage> {
  const { data } = await api.post<ScheduledMessage>(`/tickets/${ticketId}/scheduled`, body);
  return data;
}

export async function cancelScheduled(id: number): Promise<ScheduledMessage> {
  const { data } = await api.delete<ScheduledMessage>(`/scheduled/${id}`);
  return data;
}
