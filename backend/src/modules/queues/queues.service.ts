import { Op } from "sequelize";
import { Queue, WeekSchedule } from "../../models";
import { AppError, notFound } from "../../shared/errors/AppError";

export interface QueueInput {
  name: string;
  color?: string;
  schedule?: WeekSchedule;
}

export function listQueues(companyId: number) {
  return Queue.findAll({ where: { companyId }, order: [["name", "ASC"]] });
}

export async function getQueueOr404(companyId: number, id: number): Promise<Queue> {
  const queue = await Queue.findOne({ where: { id, companyId } });
  if (!queue) throw notFound("Fila");
  return queue;
}

export function createQueue(companyId: number, input: QueueInput) {
  return Queue.create({ companyId, ...input });
}

export async function updateQueue(companyId: number, id: number, input: Partial<QueueInput>) {
  const queue = await getQueueOr404(companyId, id);
  return queue.update(input);
}

export async function deleteQueue(companyId: number, id: number): Promise<void> {
  const queue = await getQueueOr404(companyId, id);
  await queue.destroy();
}

export async function assertQueuesBelong(companyId: number, ids: number[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const count = await Queue.count({ where: { companyId, id: { [Op.in]: unique } } });
  if (count !== unique.length) throw new AppError("INVALID_QUEUE", 400, "Fila inválida");
}
