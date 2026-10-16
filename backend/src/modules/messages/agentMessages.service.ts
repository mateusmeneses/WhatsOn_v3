import { Op } from "sequelize";
import { Connection, Contact, Message, Ticket } from "../../models";
import { AppError, notFound } from "../../shared/errors/AppError";
import { paginate } from "../../shared/http";
import { logger } from "../../shared/logger";
import { AuthContext } from "../auth/auth.types";
import { resolveMediaPath, StoredMedia } from "../media/media.storage";
import { emitMessage, emitTicket } from "../tickets/ticket.events";
import { getVisibleTicket } from "../tickets/tickets.service";
import { getProvider } from "../whatsapp/registry";
import { createOutgoingMessage, DELETED_PREVIEW, previewOf } from "./messages.service";
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
  const ticket = await getVisibleTicket(auth, message.ticketId);
  if (auth.profile === "agent" && ticket.userId !== auth.userId) {
    throw new AppError("FORBIDDEN", 403, "Este atendimento não está com você");
  }
  const [updated] = await Message.update({ ack: "pending" }, { where: { id: messageId, ack: "failed" } });
  if (updated === 0) throw new AppError("MESSAGE_NOT_FAILED", 409, "Só mensagens com falha podem ser reenviadas");
  await message.reload();
  emitMessage(message, "message:update");
  try {
    await enqueueOutbound(message.id, message.ticketId);
  } catch (err) {
    logger.error({ err, messageId: message.id }, "failed to enqueue resend");
    await message.update({ ack: "failed" });
    emitMessage(message, "message:update");
  }
  return message;
}

/** Limites do WhatsApp: editar até 15 min, apagar para todos até ~2 dias. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const DELETE_WINDOW_MS = 48 * 60 * 60 * 1000;

async function loadOwnSentMessage(auth: AuthContext, messageId: number) {
  const message = await Message.findOne({ where: { id: messageId, companyId: auth.companyId } });
  if (!message) throw notFound("Mensagem");
  const ticket = await getVisibleTicket(auth, message.ticketId);
  if (ticket.status !== "open") throw new AppError("TICKET_NOT_OPEN", 409, "Atendimento não está aberto");
  if (auth.profile === "agent" && ticket.userId !== auth.userId) {
    throw new AppError("FORBIDDEN", 403, "Este atendimento não está com você");
  }
  if (!message.fromMe) throw new AppError("NOT_OWN_MESSAGE", 409, "Só mensagens enviadas pelo atendimento podem ser alteradas");
  if (message.deletedAt) throw new AppError("MESSAGE_DELETED", 409, "Mensagem já apagada");
  const [contact, connection] = await Promise.all([Contact.findByPk(ticket.contactId), Connection.findByPk(ticket.connectionId)]);
  return { message, ticket, contact: contact!, connection: connection! };
}

/** Atualiza a prévia do ticket quando a mensagem alterada é a última da conversa. */
async function refreshPreview(ticket: Ticket, message: Message, preview: string): Promise<void> {
  const newer = await Message.count({ where: { ticketId: ticket.id, id: { [Op.gt]: message.id } } });
  if (newer > 0) return;
  await ticket.update({ lastMessage: preview });
  await emitTicket(ticket.id);
}

export async function editMessage(auth: AuthContext, messageId: number, body: string) {
  const { message, ticket, contact, connection } = await loadOwnSentMessage(auth, messageId);
  if (message.type !== "text") throw new AppError("NOT_EDITABLE", 409, "Só mensagens de texto podem ser editadas");
  if (!message.providerMessageId || message.ack === "pending" || message.ack === "failed") {
    throw new AppError("NOT_EDITABLE", 409, "A mensagem ainda não foi enviada");
  }
  if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
    throw new AppError("EDIT_EXPIRED", 409, "Só é possível editar até 15 minutos após o envio");
  }
  await getProvider().editText(connection.instanceName, contact.number, message.providerMessageId, body);
  await message.update({ body, editedAt: new Date() });
  emitMessage(message, "message:update");
  await refreshPreview(ticket, message, previewOf(message));
  return message;
}

export async function deleteMessage(auth: AuthContext, messageId: number) {
  const { message, ticket, contact, connection } = await loadOwnSentMessage(auth, messageId);
  if (message.ack === "pending") throw new AppError("MESSAGE_PENDING", 409, "Aguarde o envio terminar para apagar");
  if (message.providerMessageId) {
    if (Date.now() - message.createdAt.getTime() > DELETE_WINDOW_MS) {
      throw new AppError("DELETE_EXPIRED", 409, "Só é possível apagar para todos até 2 dias após o envio");
    }
    await getProvider().deleteForEveryone(connection.instanceName, contact.number, message.providerMessageId);
  }
  // Sem providerMessageId (falha no envio) o cliente nunca recebeu: basta apagar aqui.
  await message.update({ deletedAt: new Date() });
  emitMessage(message, "message:update");
  await refreshPreview(ticket, message, DELETED_PREVIEW);
  return message;
}
