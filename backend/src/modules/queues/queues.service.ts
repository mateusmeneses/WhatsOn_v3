import { Op, QueryTypes } from "sequelize";
import { sequelize } from "../../database/sequelize";
import { Company, Queue, WeekSchedule } from "../../models";
import { AppError, notFound } from "../../shared/errors/AppError";
import { isOpen } from "./schedule";

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

export interface QueueStats {
  id: number;
  /** Atendentes vinculados à fila. */
  members: number;
  /** Atendimentos aguardando e em atendimento agora. */
  pending: number;
  open: number;
  /** Dentro do horário de expediente neste instante. */
  openNow: boolean;
}

/** Situação ao vivo de cada fila (para os cartões da tela Filas). */
export async function queueStats(companyId: number): Promise<QueueStats[]> {
  const [queues, company, members, tickets] = await Promise.all([
    listQueues(companyId),
    Company.findByPk(companyId, { attributes: ["timezone"] }),
    sequelize.query<{ queueId: number; count: number }>(
      `SELECT uq."queueId", count(*)::int AS count FROM user_queues uq JOIN queues q ON q.id = uq."queueId"
       WHERE q."companyId" = :companyId GROUP BY uq."queueId"`,
      { type: QueryTypes.SELECT, replacements: { companyId } },
    ),
    sequelize.query<{ queueId: number; status: string; count: number }>(
      `SELECT "queueId", status, count(*)::int AS count FROM tickets
       WHERE "companyId" = :companyId AND "queueId" IS NOT NULL AND status IN ('pending', 'open') GROUP BY "queueId", status`,
      { type: QueryTypes.SELECT, replacements: { companyId } },
    ),
  ]);
  const tz = company?.timezone ?? "America/Sao_Paulo";
  const now = new Date();
  const count = (queueId: number, status: string) => tickets.find((t) => t.queueId === queueId && t.status === status)?.count ?? 0;
  return queues.map((q) => ({
    id: q.id,
    members: members.find((m) => m.queueId === q.id)?.count ?? 0,
    pending: count(q.id, "pending"),
    open: count(q.id, "open"),
    openNow: isOpen(q.schedule, now, tz),
  }));
}
