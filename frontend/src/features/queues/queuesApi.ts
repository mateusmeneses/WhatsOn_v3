import { api } from "@/lib/api";
import type { Queue } from "@/types/api";

export const queueKeys = { all: ["queues"] as const };

export async function fetchQueues(): Promise<Queue[]> {
  const { data } = await api.get<Queue[]>("/queues");
  return data;
}
