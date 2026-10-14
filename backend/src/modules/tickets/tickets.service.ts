import { Op } from "sequelize";
import { Connection, Contact, Ticket, TicketEvent, TicketLog, TicketStatus, User } from "../../models";
import { cancelBotTimeout } from "../../queues/botTimeout";
import { AppError, notFound } from "../../shared/errors/AppError";
import { PAGE_SIZE, paginate } from "../../shared/http";
import { AuthContext } from "../auth/auth.types";
import { createOutgoingMessage } from "../messages/messages.service";
import { assertQueuesBelong } from "../queues/queues.service";
import { userQueueIds } from "../users/userQueues";
import { getUserOr404 } from "../users/users.service";
import { emitTicket, TICKET_INCLUDE } from "./ticket.events";
import { agentQueueEligible, canView, visibilityWhere } from "./visibility";

export async function logTicket(
  ticket: Ticket,
  event: TicketEvent,
  extra: { userId?: number | null; fromQueueId?: number | null; toQueueId?: number | null } = {},
): Promise<void> {
  await TicketLog.create({
    companyId: ticket.companyId,
    ticketId: ticket.id,
    event,
    userId: extra.userId ?? null,
    fromQueueId: extra.fromQueueId ?? null,
    toQueueId: extra.toQueueId ?? null,
  });
}

export function loadTicket(id: number) {
  return Ticket.findByPk(id, { include: TICKET_INCLUDE });
}

const queueIdsFor = (auth: AuthContext) => (auth.profile === "agent" ? userQueueIds(auth.userId) : Promise.resolve([]));

export async function listTickets(auth: AuthContext, opts: { status: TicketStatus; search?: string; page: number }) {
  const visibility = visibilityWhere(auth, await queueIdsFor(auth), opts.status);
  if (visibility === null) return { items: [], hasMore: false };
  const term = opts.search?.trim();
  const rows = await Ticket.findAll({
    where: { companyId: auth.companyId, status: opts.status, ...visibility },
    include: [
      {
        model: Contact,
        ...(term
          ? { where: { [Op.or]: [{ name: { [Op.iLike]: `%${term}%` } }, { number: { [Op.like]: `%${term}%` } }] } }
          : {}),
      },
      ...TICKET_INCLUDE.slice(1),
    ],
    order: [
      ["lastMessageAt", "DESC NULLS LAST"],
      ["id", "DESC"],
    ],
    limit: PAGE_SIZE + 1,
    offset: (opts.page - 1) * PAGE_SIZE,
  });
  return paginate(rows);
}

export async function getVisibleTicket(auth: AuthContext, id: number): Promise<Ticket> {
  const ticket = await Ticket.findOne({ where: { id, companyId: auth.companyId } });
  if (!ticket) throw notFound("Ticket");
  if (!canView(auth, await queueIdsFor(auth), ticket)) throw new AppError("FORBIDDEN", 403, "Sem acesso a este ticket");
  return ticket;
}

export async function canJoinTicket(auth: AuthContext, ticketId: number): Promise<boolean> {
  try {
    await getVisibleTicket(auth, ticketId);
    return true;
  } catch {
    return false;
  }
}

const ticketClosed = () => new AppError("TICKET_CLOSED", 409, "Atendimento já finalizado");

function assertCanHandle(auth: AuthContext, ticket: Ticket): void {
  if (auth.profile === "agent" && ticket.userId !== auth.userId) {
    throw new AppError("FORBIDDEN", 403, "Este atendimento não está com você");
  }
}

export async function acceptTicket(auth: AuthContext, id: number) {
  const ticket = await Ticket.findOne({ where: { id, companyId: auth.companyId } });
  if (!ticket) throw notFound("Ticket");
  if (auth.profile === "agent") {
    const queueIds = await userQueueIds(auth.userId);
    const eligible = ticket.userId === auth.userId || agentQueueEligible(queueIds, ticket.queueId);
    if (!eligible) throw new AppError("FORBIDDEN", 403, "Sem acesso a este ticket");
  }
  const [updated] = await Ticket.update(
    { status: "open", userId: auth.userId },
    {
      where: {
        id,
        companyId: auth.companyId,
        status: "pending",
        [Op.or]: [{ userId: null }, { userId: auth.userId }],
      },
    },
  );
  if (updated === 0) {
    const current = await Ticket.findByPk(id, { include: [{ model: User, attributes: ["id", "name"] }] });
    if (current && current.userId !== null && current.userId !== auth.userId) {
      const by = current.user ? ` por ${current.user.name}` : "";
      throw new AppError("TICKET_ALREADY_ACCEPTED", 409, `Este atendimento já foi aceito${by}`);
    }
    throw new AppError("TICKET_NOT_PENDING", 409, "Este atendimento não está aguardando atendimento");
  }
  await logTicket(ticket, "accepted", { userId: auth.userId });
  await emitTicket(id, { queueId: ticket.queueId, userId: ticket.userId });
  return loadTicket(id);
}

export async function transferTicket(auth: AuthContext, id: number, input: { queueId?: number; userId?: number }) {
  const ticket = await getVisibleTicket(auth, id);
  if (ticket.status === "closed") throw ticketClosed();
  assertCanHandle(auth, ticket);
  if (input.queueId) await assertQueuesBelong(auth.companyId, [input.queueId]);
  if (input.userId) await getUserOr404(auth.companyId, input.userId);

  const prev = { queueId: ticket.queueId, userId: ticket.userId };
  const queueId = input.queueId ?? ticket.queueId;
  const [updated] = await Ticket.update(
    { status: "pending", queueId, userId: input.userId ?? null, chatbotNodeId: null, chatbotAttempts: 0 },
    { where: { id: ticket.id, status: { [Op.ne]: "closed" } } },
  );
  if (updated === 0) throw ticketClosed();
  await ticket.reload();
  await cancelBotTimeout(ticket.id);
  await logTicket(ticket, "transferred", { userId: auth.userId, fromQueueId: prev.queueId, toQueueId: queueId });
  await emitTicket(ticket.id, prev);
  return loadTicket(id);
}

export async function closeTicket(auth: AuthContext, id: number) {
  const ticket = await getVisibleTicket(auth, id);
  if (ticket.status === "closed") throw ticketClosed();
  assertCanHandle(auth, ticket);
  const closed = await closeTicketInternal(ticket, { userId: auth.userId, event: "closed", sendClosingMessage: true });
  if (!closed) throw ticketClosed();
  return loadTicket(id);
}

export async function markTicketRead(auth: AuthContext, id: number) {
  const ticket = await getVisibleTicket(auth, id);
  if (ticket.unreadCount !== 0) {
    await ticket.update({ unreadCount: 0 });
    await emitTicket(ticket.id);
  }
  return loadTicket(id);
}

/**
 * Usado pelo chatbot: tira o ticket do bot e coloca na fila (ou com o atendente).
 * Condicional ao status "bot": se o ticket já saiu do bot (assumido, fechado), não faz nada.
 */
export async function moveToPending(ticket: Ticket, queueId: number | null, userId: number | null): Promise<boolean> {
  const prev = { queueId: ticket.queueId, userId: ticket.userId };
  const [updated] = await Ticket.update(
    { status: "pending", queueId, userId, chatbotNodeId: null, chatbotAttempts: 0 },
    { where: { id: ticket.id, status: "bot" } },
  );
  if (updated === 0) return false;
  await ticket.reload();
  await cancelBotTimeout(ticket.id);
  await logTicket(ticket, "transferred", { fromQueueId: prev.queueId, toQueueId: queueId });
  await emitTicket(ticket.id, prev);
  return true;
}

/**
 * Fecha só se ninguém fechou antes (bot_timeout: só se ainda estiver no bot). Devolve se este chamado fechou;
 * mensagem de encerramento, log e evento só acontecem nesse caso.
 */
export async function closeTicketInternal(
  ticket: Ticket,
  opts: { userId: number | null; event: "closed" | "bot_timeout"; sendClosingMessage: boolean; onlyFromBot?: boolean },
): Promise<boolean> {
  const prev = { queueId: ticket.queueId, userId: ticket.userId };
  const status = opts.event === "bot_timeout" || opts.onlyFromBot ? "bot" : { [Op.ne]: "closed" };
  const [updated] = await Ticket.update(
    { status: "closed", closedAt: new Date(), chatbotNodeId: null, chatbotAttempts: 0, unreadCount: 0 },
    { where: { id: ticket.id, status } },
  );
  if (updated === 0) return false;
  await ticket.reload();
  if (opts.sendClosingMessage) {
    const connection = await Connection.findByPk(ticket.connectionId);
    if (connection?.closingMessage) await createOutgoingMessage(ticket, { body: connection.closingMessage, isBot: true });
  }
  await cancelBotTimeout(ticket.id);
  await logTicket(ticket, opts.event, { userId: opts.userId });
  await emitTicket(ticket.id, prev);
  return true;
}
