import { api } from "@/lib/api";
import type { Queue, WeekSchedule } from "@/types/api";

export const queueKeys = { all: ["queues"] as const, stats: ["queues", "stats"] as const };

export async function fetchQueues(): Promise<Queue[]> {
  const { data } = await api.get<Queue[]>("/queues");
  return data;
}

export interface QueueInput {
  name: string;
  color: string;
  schedule: WeekSchedule;
}

export async function createQueue(input: QueueInput): Promise<Queue> {
  const { data } = await api.post<Queue>("/queues", input);
  return data;
}

export async function updateQueue(id: number, input: QueueInput): Promise<Queue> {
  const { data } = await api.put<Queue>(`/queues/${id}`, input);
  return data;
}

export async function deleteQueue(id: number): Promise<void> {
  await api.delete(`/queues/${id}`);
}

export interface QueueStats {
  id: number;
  members: number;
  pending: number;
  open: number;
  /** Dentro do horário de expediente neste instante. */
  openNow: boolean;
}

export async function fetchQueueStats(): Promise<QueueStats[]> {
  const { data } = await api.get<QueueStats[]>("/queues/stats");
  return data;
}
