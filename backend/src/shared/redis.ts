import IORedis from "ioredis";
import { env } from "../config/env";

let shared: IORedis | null = null;

/** Conexão compartilhada para comandos comuns e Queues do BullMQ. */
export function getRedis(): IORedis {
  if (!shared) shared = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return shared;
}

/** Conexão dedicada (Workers do BullMQ usam comandos bloqueantes). */
export function createRedis(): IORedis {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export async function closeRedis(): Promise<void> {
  if (shared) {
    await shared.quit();
    shared = null;
  }
}
