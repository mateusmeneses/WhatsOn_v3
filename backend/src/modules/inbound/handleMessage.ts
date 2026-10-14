import { Op, UniqueConstraintError } from "sequelize";
import { Connection, Contact, Message, MessageType, Ticket, TicketStatus } from "../../models";
import { cancelBotTimeout } from "../../queues/botTimeout";
import { logger } from "../../shared/logger";
import { hasBot, runBot } from "../chatbot/chatbot.service";
import { saveBase64, StoredMedia } from "../media/media.storage";
import { previewOf } from "../messages/messages.service";
import { emitMessage, emitTicket } from "../tickets/ticket.events";
import { logTicket } from "../tickets/tickets.service";
import { InboundMessage } from "../whatsapp/provider";
import { getProvider } from "../whatsapp/registry";

const MEDIA_TYPES: MessageType[] = ["image", "audio", "video", "document", "sticker"];
const ECHO_WINDOW_MS = 120_000;

async function upsertContact(companyId: number, ev: InboundMessage): Promise<Contact> {
  const pushName = !ev.fromMe && ev.pushName ? ev.pushName : null;
  const [contact, created] = await Contact.findOrCreate({
    where: { companyId, number: ev.remoteNumber },
    defaults: { companyId, number: ev.remoteNumber, name: pushName ?? ev.remoteNumber, isGroup: false },
  });
  if (!created && pushName && contact.name === contact.number) await contact.update({ name: pushName });
  return contact;
}

/** Mensagem que nós enviamos e voltou como fromMe antes de gravarmos o id do WhatsApp. */
async function matchPendingEcho(connectionId: number, contactId: number, ev: InboundMessage): Promise<boolean> {
  const candidate = await Message.findOne({
    where: {
      connectionId,
      fromMe: true,
      providerMessageId: null,
      ack: "pending",
      body: ev.body,
      createdAt: { [Op.gte]: new Date(Date.now() - ECHO_WINDOW_MS) },
    },
    include: [{ model: Ticket, where: { contactId }, attributes: [] }],
    order: [["id", "ASC"]],
  });
  if (!candidate) return false;
  await Message.update({ providerMessageId: ev.providerMessageId, ack: "sent" }, { where: { id: candidate.id } });
  await candidate.reload();
  emitMessage(candidate, "message:update");
  return true;
}

async function findOrCreateTicket(connection: Connection, contact: Contact, fromMe: boolean): Promise<Ticket> {
  const where = { contactId: contact.id, connectionId: connection.id, status: { [Op.ne]: "closed" } };
  const open = await Ticket.findOne({ where });
  if (open) return open;

  const status: TicketStatus = fromMe ? "open" : (await hasBot(connection.id)) ? "bot" : "pending";
  try {
    const ticket = await Ticket.create({
      companyId: connection.companyId,
      contactId: contact.id,
      connectionId: connection.id,
      status,
      queueId: status === "pending" ? connection.defaultQueueId : null,
    });
    await logTicket(ticket, "created");
    return ticket;
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      const existing = await Ticket.findOne({ where });
      if (existing) return existing;
    }
    throw err;
  }
}

async function fetchMedia(
  connection: Connection,
  ev: InboundMessage,
  opts: { finalAttempt: boolean },
): Promise<{ media: StoredMedia | null; body: string }> {
  if (!MEDIA_TYPES.includes(ev.type)) return { media: null, body: ev.body };
  try {
    const file = await getProvider().downloadMedia(connection.instanceName, ev.providerMessageId);
    const mime = file.mimetype || ev.media?.mimetype || "application/octet-stream";
    const media = await saveBase64(connection.companyId, file.base64, mime, ev.media?.fileName ?? null);
    return { media, body: ev.body };
  } catch (err) {
    if (!opts.finalAttempt) throw err;
    logger.warn({ err, connectionId: connection.id, providerMessageId: ev.providerMessageId }, "media download failed");
    return { media: null, body: ev.body || "[mídia indisponível]" };
  }
}

async function resolveQuoted(connectionId: number, providerMessageId?: string): Promise<number | null> {
  if (!providerMessageId) return null;
  const quoted = await Message.findOne({ where: { connectionId, providerMessageId }, attributes: ["id"] });
  return quoted?.id ?? null;
}

async function takeOverFromBot(ticket: Ticket): Promise<void> {
  await ticket.update({ status: "open", userId: null, chatbotNodeId: null, chatbotAttempts: 0 });
  await cancelBotTimeout(ticket.id);
  await logTicket(ticket, "accepted");
}

export async function handleInboundMessage(
  connection: Connection,
  ev: InboundMessage,
  opts: { finalAttempt: boolean },
): Promise<void> {
  if (ev.isGroup) return;
  if (await Message.count({ where: { connectionId: connection.id, providerMessageId: ev.providerMessageId } })) return;

  const contact = await upsertContact(connection.companyId, ev);
  if (ev.fromMe && (await matchPendingEcho(connection.id, contact.id, ev))) return;

  const ticket = await findOrCreateTicket(connection, contact, ev.fromMe);
  const { media, body } = await fetchMedia(connection, ev, opts);

  let message: Message;
  try {
    message = await Message.create({
      companyId: connection.companyId,
      ticketId: ticket.id,
      connectionId: connection.id,
      providerMessageId: ev.providerMessageId,
      fromMe: ev.fromMe,
      body,
      type: ev.type,
      mediaUrl: media?.url ?? null,
      mediaMime: media?.mime ?? null,
      mediaName: media?.name ?? null,
      ack: ev.fromMe ? "sent" : "delivered",
      quotedMessageId: await resolveQuoted(connection.id, ev.quotedProviderMessageId),
      isBot: false,
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) return;
    throw err;
  }

  await ticket.update({
    lastMessage: previewOf(message),
    lastMessageAt: new Date(),
    unreadCount: ev.fromMe ? ticket.unreadCount : ticket.unreadCount + 1,
  });
  emitMessage(message, "message:new");

  if (ev.fromMe && ticket.status === "bot") await takeOverFromBot(ticket);
  await emitTicket(ticket.id);

  if (!ev.fromMe && ticket.status === "bot") await runBot(ticket, ev.type === "text" ? ev.body : null);
}
