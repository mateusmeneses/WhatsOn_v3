import { getRedis } from "../../src/shared/redis";

export async function resetRedis(): Promise<void> {
  await getRedis().flushdb();
}
