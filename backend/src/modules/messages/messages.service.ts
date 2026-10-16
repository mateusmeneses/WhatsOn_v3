import { Ack, Message, MessageType, Ticket } from "../../models";
import { mediaTypeFromMime, StoredMedia } from "../media/media.storage";
import { emitMessage, emitTicket } from "../tickets/ticket.events";
import { logger } from "../../shared/logger";
import { enqueueOutbound } from "./outbound";

export interface OutgoingInput {
  body?: string;
  media?: StoredMedia | null;
  quotedMessageId?: number | null;
  sentByUserId?: number | null;
  isBot?: boolean;
}

const TYPE_LABEL: Record<MessageType, string> = {
  text: "",
  image: "📷 Imagem",
  audio: "🎤 Áudio",
  video: "🎬 Vídeo",
  document: "📄 Documento",
  sticker: "Figurinha",
  location: "📍 Localização",
};

export const DELETED_PREVIEW = "🚫 Mensagem apagada";

export function previewOf(m: { body: string; type: MessageType }): string {
  return m.body || TYPE_LABEL[m.type];
}

export async function createOutgoingMessage(ticket: Ticket, input: OutgoingInput): Promise<Message> {
  const media = input.media ?? null;
  const message = await Message.create({
    companyId: ticket.companyId,
    ticketId: ticket.id,
    connectionId: ticket.connectionId,
    fromMe: true,
    body: input.body ?? "",
    type: media ? mediaTypeFromMime(media.mime) : "text",
    mediaUrl: media?.url ?? null,
    mediaMime: media?.mime ?? null,
    mediaName: media?.name ?? null,
    ack: "pending",
    quotedMessageId: input.quotedMessageId ?? null,
    sentByUserId: input.sentByUserId ?? null,
    isBot: input.isBot ?? false,
  });
  await ticket.update({ lastMessage: previewOf(message), lastMessageAt: new Date() });
  emitMessage(message, "message:new");
  await emitTicket(ticket.id);
  try {
    await enqueueOutbound(message.id, ticket.id);
  } catch (err) {
    logger.error({ err, messageId: message.id }, "failed to enqueue outbound message");
    await Message.update({ ack: "failed" }, { where: { id: message.id } });
    await message.reload();
    emitMessage(message, "message:update");
  }
  return message;
}

const ACK_RANK: Record<Ack, number> = { failed: -1, pending: 0, sent: 1, delivered: 2, read: 3 };

export async function applyAck(connectionId: number, providerMessageId: string, ack: Ack): Promise<void> {
  const message = await Message.findOne({ where: { connectionId, providerMessageId } });
  if (!message) return;
  const allowed =
    ack === "failed" ? message.ack === "pending" || message.ack === "sent" : ACK_RANK[ack] > ACK_RANK[message.ack];
  if (!allowed) return;
  await message.update({ ack });
  emitMessage(message, "message:update");
}
