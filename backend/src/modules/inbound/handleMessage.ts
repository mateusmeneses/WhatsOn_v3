import { Op, UniqueConstraintError } from "sequelize";
import { Connection, Contact, Message, MessageType, Ticket, TicketStatus } from "../../models";
import { sequelize } from "../../database/sequelize";
import { cancelBotTimeout } from "../../queues/botTimeout";
import { logger } from "../../shared/logger";
import { retryInline } from "../../shared/retry";
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
  // contato apagado que voltou a mandar mensagem: reativa para a conversa não sumir
  if (contact.deletedAt) await contact.update({ deletedAt: null });
  return contact;
}

const ECHO_MEDIA_TYPES: MessageType[] = ["document", "image", "video", "audio"];

/**
 * Mensagem que nós enviamos e voltou como fromMe antes de gravarmos o id do WhatsApp.
 * Casa pelo tipo e pelo texto; para mídia também pelo nome do arquivo ou legenda vazia
 * (o eco de um documento sem legenda traz o nome do arquivo como corpo). Mais antiga primeiro.
 */
async function matchPendingEcho(connectionId: number, contactId: number, ev: InboundMessage): Promise<boolean> {
  const sameContent: Record<string | symbol, unknown>[] = [{ body: ev.body }];
  if (ECHO_MEDIA_TYPES.includes(ev.type)) {
    sameContent.push({ body: "" });
    if (ev.media?.fileName) sameContent.push({ mediaName: ev.media.fileName });
  }
  const candidate = await Message.findOne({
    where: {
      connectionId,
      fromMe: true,
      providerMessageId: null,
      ack: "pending",
      type: ev.type,
      [Op.or]: sameContent,
      createdAt: { [Op.gte]: new Date(Date.now() - ECHO_WINDOW_MS) },
    },
    include: [{ model: Ticket, where: { contactId }, attributes: [] }],
    order: [["id", "ASC"]],
  });
  if (!candidate) return false;
  const [claimed] = await Message.update(
    { providerMessageId: ev.providerMessageId, ack: "sent" },
    { where: { id: candidate.id, providerMessageId: null, ack: "pending" } },
  );
  if (claimed === 0) return false;
  await candidate.reload();
  emitMessage(candidate, "message:update");
  return true;
}

export async function findOrCreateTicket(connection: Connection, contact: Contact, fromMe: boolean): Promise<Ticket> {
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
    const file = await retryInline(() => getProvider().downloadMedia(connection.instanceName, ev.providerMessageId));
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

export async function handleInboundMessage(
  connection: Connection,
  ev: InboundMessage,
  opts: { finalAttempt: boolean },
): Promise<void> {
  if (ev.isGroup) return;
  if (await Message.count({ where: { connectionId: connection.id, providerMessageId: ev.providerMessageId } })) return;

  const contact = await upsertContact(connection.companyId, ev);
  if (ev.fromMe && (await matchPendingEcho(connection.id, contact.id, ev))) return;

  const { media, body } = await fetchMedia(connection, ev, opts);
  const ticket = await findOrCreateTicket(connection, contact, ev.fromMe);
  const quotedMessageId = await resolveQuoted(connection.id, ev.quotedProviderMessageId);

  let message: Message;
  let tookOver = false;
  try {
    ({ message, tookOver } = await sequelize.transaction(async (transaction) => {
      const created = await Message.create(
        {
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
          quotedMessageId,
          isBot: false,
        },
        { transaction },
      );
      await Ticket.update(
        { lastMessage: previewOf(created), lastMessageAt: new Date() },
        { where: { id: ticket.id }, transaction },
      );
      if (!ev.fromMe) await Ticket.increment("unreadCount", { by: 1, where: { id: ticket.id }, transaction });
      let took = false;
      // Eco não reconciliado de uma mensagem nossa (bot) ainda pendente não pode tirar o ticket do bot.
      const ownPending = ev.fromMe
        ? await Message.count({ where: { ticketId: ticket.id, fromMe: true, ack: "pending" }, transaction })
        : 0;
      if (ev.fromMe && ownPending === 0) {
        const [n] = await Ticket.update(
          { status: "open", userId: null, chatbotNodeId: null, chatbotAttempts: 0 },
          { where: { id: ticket.id, status: "bot" }, transaction },
        );
        took = n === 1;
      }
      return { message: created, tookOver: took };
    }));
  } catch (err) {
    if (err instanceof UniqueConstraintError) return;
    throw err;
  }

  emitMessage(message, "message:new");
  if (tookOver) {
    await cancelBotTimeout(ticket.id);
    await logTicket(ticket, "accepted");
  }
  await emitTicket(ticket.id);

  if (ev.fromMe) return;
  await ticket.reload();
  if (ticket.status !== "bot") return;
  try {
    await runBot(ticket, ev.type === "text" ? ev.body : null);
  } catch (err) {
    logger.error(
      { err, connectionId: connection.id, ticketId: ticket.id, providerMessageId: ev.providerMessageId },
      "chatbot failed",
    );
  }
}
