import { Op } from "sequelize";
import { ScheduledMessage, Ticket } from "../../models";
import { AppError, notFound } from "../../shared/errors/AppError";
import { logger } from "../../shared/logger";
import { AuthContext } from "../auth/auth.types";
import { isCompanyBlocked } from "../companies/companyStatus";
import { createOutgoingMessage } from "../messages/messages.service";
import { emitter, rooms } from "../realtime/socket";
import { getVisibleTicket, reopenTicketInternal } from "../tickets/tickets.service";

const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;
const DISPATCH_BATCH = 50;

function emitScheduled(ticketId: number): void {
  emitter.toRooms([rooms.ticket(ticketId)], "scheduled:update", { ticketId });
}

function assertCanSchedule(auth: AuthContext, ticket: Ticket): void {
  if (auth.profile === "agent" && ticket.userId !== auth.userId) {
    throw new AppError("FORBIDDEN", 403, "Este atendimento não está com você");
  }
}

export async function listScheduled(auth: AuthContext, ticketId: number) {
  await getVisibleTicket(auth, ticketId);
  return ScheduledMessage.findAll({
    where: { ticketId, status: { [Op.in]: ["pending", "sending", "failed"] } },
    order: [["sendAt", "ASC"]],
  });
}

export async function createScheduled(auth: AuthContext, ticketId: number, input: { body: string; sendAt: Date }) {
  const ticket = await getVisibleTicket(auth, ticketId);
  assertCanSchedule(auth, ticket);
  const delta = input.sendAt.getTime() - Date.now();
  if (delta <= 0) throw new AppError("INVALID_SEND_AT", 400, "Escolha uma data e hora no futuro");
  if (delta > MAX_AHEAD_MS) throw new AppError("INVALID_SEND_AT", 400, "Agende para no máximo um ano à frente");
  const row = await ScheduledMessage.create({
    companyId: auth.companyId,
    ticketId,
    userId: auth.userId,
    body: input.body,
    sendAt: input.sendAt,
  });
  emitScheduled(ticketId);
  return row;
}

export async function cancelScheduled(auth: AuthContext, id: number) {
  const row = await ScheduledMessage.findOne({ where: { id, companyId: auth.companyId } });
  if (!row) throw notFound("Agendamento");
  const ticket = await getVisibleTicket(auth, row.ticketId);
  if (auth.profile === "agent" && row.userId !== auth.userId) assertCanSchedule(auth, ticket);
  const [updated] = await ScheduledMessage.update(
    { status: "canceled" },
    { where: { id, status: { [Op.in]: ["pending", "failed"] } } },
  );
  if (updated === 0) throw new AppError("SCHEDULE_NOT_PENDING", 409, "Este agendamento já foi enviado");
  emitScheduled(row.ticketId);
  await row.reload();
  return row;
}

/** Chamado finalizado: reabre com quem agendou; se o contato já tem outro em andamento, usa esse. */
async function targetTicket(row: ScheduledMessage): Promise<Ticket> {
  const ticket = await Ticket.findByPk(row.ticketId);
  if (!ticket) throw new Error("ticket not found");
  if (ticket.status !== "closed") return ticket;
  try {
    await reopenTicketInternal(ticket, row.userId);
    await ticket.reload();
    return ticket;
  } catch (err) {
    if (!(err instanceof AppError) || err.code !== "TICKET_ACTIVE_EXISTS") throw err;
    const active = await Ticket.findOne({
      where: { contactId: ticket.contactId, connectionId: ticket.connectionId, status: { [Op.ne]: "closed" } },
    });
    if (!active) throw err;
    return active;
  }
}

async function sendOne(row: ScheduledMessage): Promise<void> {
  try {
    if (await isCompanyBlocked(row.companyId)) throw new Error("Empresa bloqueada");
    const ticket = await targetTicket(row);
    const message = await createOutgoingMessage(ticket, { body: row.body, sentByUserId: row.userId });
    await row.update({ status: "sent", messageId: message.id, error: null });
  } catch (err) {
    logger.error({ err, scheduledId: row.id }, "failed to send scheduled message");
    await row.update({ status: "failed", error: err instanceof Error ? err.message : String(err) });
  }
  emitScheduled(row.ticketId);
}

/** Envia os agendamentos vencidos. Cada linha é "reservada" antes, então execuções paralelas não duplicam. */
export async function dispatchDueScheduled(now = new Date()): Promise<number> {
  const due = await ScheduledMessage.findAll({
    where: { status: "pending", sendAt: { [Op.lte]: now } },
    order: [["sendAt", "ASC"]],
    limit: DISPATCH_BATCH,
  });
  let sent = 0;
  for (const row of due) {
    const [claimed] = await ScheduledMessage.update({ status: "sending" }, { where: { id: row.id, status: "pending" } });
    if (claimed === 0) continue;
    await sendOne(row);
    sent += 1;
  }
  return sent;
}
