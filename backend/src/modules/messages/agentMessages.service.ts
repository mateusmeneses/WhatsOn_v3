import { Op } from "sequelize";
import { Message } from "../../models";
import { AppError, notFound } from "../../shared/errors/AppError";
import { paginate } from "../../shared/http";
import { AuthContext } from "../auth/auth.types";
import { resolveMediaPath, StoredMedia } from "../media/media.storage";
import { emitMessage } from "../tickets/ticket.events";
import { getVisibleTicket } from "../tickets/tickets.service";
import { createOutgoingMessage } from "./messages.service";
import { enqueueOutbound } from "./outbound";

export async function listMessages(auth: AuthContext, ticketId: number, opts: { before?: number; limit?: number }) {
  await getVisibleTicket(auth, ticketId);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const rows = await Message.findAll({
    where: { ticketId, ...(opts.before ? { id: { [Op.lt]: opts.before } } : {}) },
    order: [["id", "DESC"]],
    limit: limit + 1,
  });
  const page = paginate(rows, limit);
  return { items: page.items.reverse(), hasMore: page.hasMore };
}

export async function sendAgentMessage(
  auth: AuthContext,
  ticketId: number,
  input: { body?: string; quotedMessageId?: number; media?: StoredMedia },
) {
  const ticket = await getVisibleTicket(auth, ticketId);
  if (ticket.status !== "open") throw new AppError("TICKET_NOT_OPEN", 409, "Aceite o atendimento antes de responder");
  if (auth.profile === "agent" && ticket.userId !== auth.userId) {
    throw new AppError("FORBIDDEN", 403, "Este atendimento não está com você");
  }
  if (input.media) resolveMediaPath(auth.companyId, input.media.url);
  if (input.quotedMessageId) {
    const quoted = await Message.findOne({ where: { id: input.quotedMessageId, ticketId } });
    if (!quoted) throw new AppError("INVALID_QUOTED", 400, "Mensagem citada inválida");
  }
  return createOutgoingMessage(ticket, {
    body: input.body,
    media: input.media ?? null,
    quotedMessageId: input.quotedMessageId ?? null,
    sentByUserId: auth.userId,
  });
}

export async function resendMessage(auth: AuthContext, messageId: number) {
  const message = await Message.findOne({ where: { id: messageId, companyId: auth.companyId } });
  if (!message) throw notFound("Mensagem");
  await getVisibleTicket(auth, message.ticketId);
  if (message.ack !== "failed") throw new AppError("MESSAGE_NOT_FAILED", 409, "Só mensagens com falha podem ser reenviadas");
  await message.update({ ack: "pending" });
  emitMessage(message, "message:update");
  await enqueueOutbound(message.id, message.ticketId);
  return message;
}
