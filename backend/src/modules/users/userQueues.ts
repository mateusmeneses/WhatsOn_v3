import { UserQueue } from "../../models";

export async function userQueueIds(userId: number): Promise<number[]> {
  const rows = await UserQueue.findAll({ where: { userId } });
  return rows.map((r) => r.queueId);
}

export async function setUserQueues(userId: number, queueIds: number[]): Promise<void> {
  await UserQueue.destroy({ where: { userId } });
  const unique = [...new Set(queueIds)];
  if (unique.length) await UserQueue.bulkCreate(unique.map((queueId) => ({ userId, queueId })));
}
