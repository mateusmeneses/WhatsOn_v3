import { Op, UniqueConstraintError } from "sequelize";
import { Connection, Contact, Message, Queue, Ticket, TicketEvent, TicketLog, TicketStatus, User } from "../../models";
import { cancelBotTimeout } from "../../queues/botTimeout";
import { AppError, notFound } from "../../shared/errors/AppError";
import { PAGE_SIZE, paginate } from "../../shared/http";
import { AuthContext } from "../auth/auth.types";
import { createOutgoingMessage } from "../messages/messages.service";
import { assertQueuesBelong } from "../queues/queues.service";
import { getUserOr404 } from "../users/users.service";
import { emitTicket, emitTicketClaimed, TICKET_INCLUDE } from "./ticket.events";
import { agentQueueEligible, canView, loadAgentScope, visibilityWhere } from "./visibility";

export async function logTicket(
  ticket: Ticket,
  event: TicketEvent,
  extra: {
    userId?: number | null;
    fromQueueId?: number | null;
    toQueueId?: number | null;
    toUserId?: number | null;
    fromUserId?: number | null;
    note?: string | null;
  } = {},
): Promise<void> {
  await TicketLog.create({
    companyId: ticket.companyId,
    ticketId: ticket.id,
    event,
    userId: extra.userId ?? null,
    fromQueueId: extra.fromQueueId ?? null,
    toQueueId: extra.toQueueId ?? null,
    toUserId: extra.toUserId ?? null,
    fromUserId: extra.fromUserId ?? null,
    note: extra.note ?? null,
  });
}

export function loadTicket(id: number) {
  return Ticket.findByPk(id, { include: TICKET_INCLUDE });
}

export interface TicketHistoryEntry {
  id: number;
  event: TicketEvent;
  createdAt: Date;
  /** Quem fez a ação (null = sistema/cliente). */
  user: { id: number; name: string } | null;
  fromQueue: { id: number; name: string; color: string } | null;
  toQueue: { id: number; name: string; color: string } | null;
  /** Transferência direta para um técnico. */
  toUser: { id: number; name: string } | null;
  /** Requerido: técnico de quem o atendimento foi tirado. */
  fromUser: { id: number; name: string } | null;
  /** Recado interno deixado ao requerer. */
  note: string | null;
}

/** Linha do tempo do chamado (criação, aceites, transferências, finalização), da mais antiga para a mais nova. */
export async function ticketHistory(ticket: Ticket): Promise<TicketHistoryEntry[]> {
  const logs = await TicketLog.findAll({ where: { ticketId: ticket.id }, order: [["createdAt", "ASC"], ["id", "ASC"]] });
  const userIds = [...new Set(logs.flatMap((l) => [l.userId, l.toUserId, l.fromUserId]).filter((id): id is number => id !== null))];
  const queueIds = [...new Set(logs.flatMap((l) => [l.fromQueueId, l.toQueueId]).filter((id): id is number => id !== null))];
  const [users, queues] = await Promise.all([
    userIds.length ? User.findAll({ where: { id: userIds }, attributes: ["id", "name"] }) : [],
    queueIds.length ? Queue.findAll({ where: { id: queueIds, companyId: ticket.companyId }, attributes: ["id", "name", "color"] }) : [],
  ]);
  const userOf = (id: number | null) => {
    const u = id === null ? undefined : users.find((x) => x.id === id);
    return u ? { id: u.id, name: u.name } : null;
  };
  const queueOf = (id: number | null) => {
    const q = id === null ? undefined : queues.find((x) => x.id === id);
    return q ? { id: q.id, name: q.name, color: q.color } : null;
  };
  return logs.map((l) => ({
    id: l.id,
    event: l.event,
    createdAt: l.createdAt,
    user: userOf(l.userId),
    fromQueue: queueOf(l.fromQueueId),
    toQueue: queueOf(l.toQueueId),
    toUser: userOf(l.toUserId),
    fromUser: userOf(l.fromUserId),
    note: l.note,
  }));
}

/**
 * Atendentes que já passaram pelo chamado: quem aceitou/reabriu, quem respondeu e o atendente atual,
 * na ordem em que entraram (o atual por último se ainda não aparece no histórico).
 */
export async function ticketAttendants(ticket: Ticket): Promise<{ id: number; name: string }[]> {
  const [logs, messages] = await Promise.all([
    TicketLog.findAll({
      where: { ticketId: ticket.id, event: ["accepted", "reopened", "claimed"], userId: { [Op.ne]: null } },
      attributes: ["userId", "createdAt"],
    }),
    Message.findAll({
      where: { ticketId: ticket.id, sentByUserId: { [Op.ne]: null } },
      attributes: ["sentByUserId", "createdAt"],
    }),
  ]);
  const firstSeen = new Map<number, number>();
  const seen = (userId: number, at: number) => {
    const prev = firstSeen.get(userId);
    if (prev === undefined || prev > at) firstSeen.set(userId, at);
  };
  for (const log of logs) seen(log.userId!, log.createdAt.getTime());
  for (const msg of messages) seen(msg.sentByUserId!, msg.createdAt.getTime());
  if (ticket.userId !== null) seen(ticket.userId, Number.MAX_SAFE_INTEGER);
  if (firstSeen.size === 0) return [];
  const users = await User.findAll({
    where: { id: [...firstSeen.keys()], companyId: ticket.companyId },
    attributes: ["id", "name"],
  });
  return users
    .sort((a, b) => firstSeen.get(a.id)! - firstSeen.get(b.id)!)
    .map((u) => ({ id: u.id, name: u.name }));
}


export async function listTickets(auth: AuthContext, opts: { status: TicketStatus; search?: string; page: number }) {
  const visibility = visibilityWhere(auth, await loadAgentScope(auth), opts.status);
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
  if (!canView(auth, await loadAgentScope(auth), ticket)) throw new AppError("FORBIDDEN", 403, "Sem acesso a este ticket");
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
    const scope = await loadAgentScope(auth);
    const eligible =
      ticket.userId === auth.userId ||
      (ticket.status === "bot" ? scope.canViewBot : agentQueueEligible(scope, ticket.queueId));
    if (!eligible) throw new AppError("FORBIDDEN", 403, "Sem acesso a este ticket");
  }
  // Chamado ainda no bot também pode ser assumido: sai do fluxo do chatbot direto para o atendente.
  const [updated] = await Ticket.update(
    { status: "open", userId: auth.userId, chatbotNodeId: null, chatbotAttempts: 0 },
    {
      where: {
        id,
        companyId: auth.companyId,
        status: ["pending", "bot"],
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
  if (ticket.status === "bot") await cancelBotTimeout(ticket.id);
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
  await logTicket(ticket, "transferred", {
    userId: auth.userId,
    fromQueueId: prev.queueId,
    toQueueId: queueId,
    toUserId: input.userId ?? null,
  });
  await emitTicket(ticket.id, prev);
  return loadTicket(id);
}

/**
 * Requerer: traz para quem pede qualquer atendimento não finalizado (bot, aguardando ou com outro técnico),
 * na hora e sem aprovação. Admin sempre pode; os demais só com `canClaimTickets`.
 * O recado vai só para o técnico anterior (aviso em tempo real + histórico), nunca para o cliente.
 */
export async function claimTicket(auth: AuthContext, id: number, input: { note?: string }) {
  if (auth.profile !== "admin") {
    const me = await User.findByPk(auth.userId, { attributes: ["canClaimTickets"] });
    if (!me?.canClaimTickets) throw new AppError("FORBIDDEN", 403, "Sem permissão para requerer atendimentos");
  }
  const ticket = await Ticket.findOne({ where: { id, companyId: auth.companyId } });
  if (!ticket) throw notFound("Ticket");
  if (ticket.status === "closed") throw ticketClosed();
  if (ticket.status === "open" && ticket.userId === auth.userId) {
    throw new AppError("TICKET_ALREADY_YOURS", 409, "Este atendimento já está com você");
  }

  const prev = { queueId: ticket.queueId, userId: ticket.userId };
  // Só leva quem viu o estado atual: dois pedidos simultâneos não tiram o atendimento um do outro.
  const [updated] = await Ticket.update(
    { status: "open", userId: auth.userId, chatbotNodeId: null, chatbotAttempts: 0 },
    { where: { id, companyId: auth.companyId, status: ticket.status, userId: ticket.userId } },
  );
  if (updated === 0) throw new AppError("TICKET_CHANGED", 409, "O atendimento mudou enquanto você requeria; tente de novo");
  if (ticket.status === "bot") await cancelBotTimeout(ticket.id);

  const note = input.note?.trim() || null;
  const fromUserId = prev.userId !== auth.userId ? prev.userId : null;
  await logTicket(ticket, "claimed", { userId: auth.userId, fromUserId, note });
  await emitTicket(id, prev);
  if (fromUserId !== null) await emitTicketClaimed(id, fromUserId, auth.userId, note);
  return loadTicket(id);
}

/** `sendClosingMessage: false` encerra sem a mensagem de finalização da conexão. */
export async function closeTicket(auth: AuthContext, id: number, opts: { sendClosingMessage?: boolean } = {}) {
  const ticket = await getVisibleTicket(auth, id);
  if (ticket.status === "closed") throw ticketClosed();
  assertCanHandle(auth, ticket);
  const closed = await closeTicketInternal(ticket, {
    userId: auth.userId,
    event: "closed",
    sendClosingMessage: opts.sendClosingMessage ?? true,
  });
  if (!closed) throw ticketClosed();
  return loadTicket(id);
}

const activeTicketExists = () =>
  new AppError("TICKET_ACTIVE_EXISTS", 409, "Este contato já tem um atendimento em andamento nesta conexão");

/**
 * Reabre um chamado finalizado com o atendente informado (sem atendente volta para a fila como pendente).
 * Devolve false se o chamado não estava mais finalizado.
 */
export async function reopenTicketInternal(ticket: Ticket, userId: number | null): Promise<boolean> {
  const prev = { queueId: ticket.queueId, userId: ticket.userId };
  let updated: number;
  try {
    [updated] = await Ticket.update(
      { status: userId ? "open" : "pending", userId, closedAt: null, unreadCount: 0 },
      { where: { id: ticket.id, status: "closed" } },
    );
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw activeTicketExists();
    throw err;
  }
  if (updated === 0) return false;
  await ticket.reload();
  await logTicket(ticket, "reopened", { userId });
  await emitTicket(ticket.id, prev);
  return true;
}

export async function reopenTicket(auth: AuthContext, id: number) {
  const ticket = await getVisibleTicket(auth, id);
  if (ticket.status !== "closed") throw new AppError("TICKET_NOT_CLOSED", 409, "Este atendimento não está finalizado");
  if (!(await reopenTicketInternal(ticket, auth.userId))) {
    throw new AppError("TICKET_NOT_CLOSED", 409, "Este atendimento não está finalizado");
  }
  return loadTicket(id);
}

export async function markTicketRead(auth: AuthContext, id: number) {
  const ticket = await getVisibleTicket(auth, id);
  // Atendente só espiando o atendimento de um colega não zera o contador dele.
  const watchingColleague = auth.profile === "agent" && ticket.status === "open" && ticket.userId !== auth.userId;
  if (ticket.unreadCount !== 0 && !watchingColleague) {
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
