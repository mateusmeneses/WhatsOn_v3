import { Op } from "sequelize";
import { Connection, Contact, Message, Ticket } from "../../models";
import { AppError } from "../../shared/errors/AppError";
import { disconnectConnection, getConnectionQrCode } from "../connections/connections.service";
import { saveBuffer, StoredMedia } from "../media/media.storage";
import { createOutgoingMessage } from "../messages/messages.service";
import { logTicket } from "../tickets/tickets.service";
import { normalizePhone } from "../users/welcome";
import { getProvider } from "../whatsapp/registry";
import { fetchRemoteMedia } from "./remoteMedia";

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

interface OutgoingItem {
  body: string;
  media: StoredMedia | null;
}

function assertConnected(connection: Connection): void {
  if (connection.status !== "connected") {
    throw new AppError("CONNECTION_NOT_CONNECTED", 409, "A conexão não está ativa; leia o QR code primeiro");
  }
}

export function connectionStatus(connection: Connection) {
  return { status: connection.status, number: connection.number };
}

export async function connectionQrCode(connection: Connection) {
  try {
    const { qr } = await getConnectionQrCode(connection.companyId, connection.id);
    await connection.reload();
    return { qrcode: qr, status: connection.status };
  } catch (err) {
    if (err instanceof AppError && err.code === "ALREADY_CONNECTED") return { qrcode: null, status: "connected" };
    throw err;
  }
}

export async function connectionLogout(connection: Connection) {
  const updated = await disconnectConnection(connection.companyId, connection.id);
  return { status: updated.status };
}

export async function checkNumber(connection: Connection, rawNumber: string) {
  assertConnected(connection);
  return getProvider().checkNumber(connection.instanceName, normalizePhone(rawNumber));
}

/** Usa o número do jid devolvido pelo WhatsApp (ex.: sem o nono dígito), o mesmo que chega no webhook. */
async function resolveContact(connection: Connection, rawNumber: string): Promise<Contact> {
  const { exists, jid } = await checkNumber(connection, rawNumber);
  if (!exists || !jid) throw new AppError("NUMBER_NOT_ON_WHATSAPP", 404, "O número não está no WhatsApp");
  const number = jid.split("@")[0].split(":")[0];
  const [contact] = await Contact.findOrCreate({
    where: { companyId: connection.companyId, number },
    defaults: { companyId: connection.companyId, number, name: number, isGroup: false },
  });
  if (contact.deletedAt) await contact.update({ deletedAt: null });
  return contact;
}

const summary = (m: Message) => ({ id: m.id, type: m.type, ack: m.ack });

/**
 * Mensagem de outro sistema (notificação) não abre atendimento: sem um em andamento com o contato,
 * fica registrada num ticket já finalizado. A resposta do contato abre um novo, pelo fluxo normal.
 */
async function apiTicket(connection: Connection, contact: Contact): Promise<Ticket> {
  const active = await Ticket.findOne({
    where: { contactId: contact.id, connectionId: connection.id, status: { [Op.ne]: "closed" } },
  });
  if (active) return active;
  const ticket = await Ticket.create({
    companyId: connection.companyId,
    contactId: contact.id,
    connectionId: connection.id,
    status: "closed",
    closedAt: new Date(),
  });
  await logTicket(ticket, "created");
  return ticket;
}

/**
 * Envia pelo fluxo normal de saída: a mensagem entra no ticket do contato
 * e é despachada pela fila de outbound, como se o atendimento tivesse enviado.
 */
async function sendToTicket(connection: Connection, rawNumber: string, items: OutgoingItem[]) {
  const contact = await resolveContact(connection, rawNumber);
  const ticket = await apiTicket(connection, contact);
  const messages: Message[] = [];
  for (const item of items) messages.push(await createOutgoingMessage(ticket, item));
  return { ticketId: ticket.id, contactId: contact.id, number: contact.number, messages: messages.map(summary) };
}

export async function sendMessage(
  connection: Connection,
  input: { number: string; body?: string; files?: UploadedFile[] },
) {
  assertConnected(connection);
  const body = input.body?.trim() ?? "";
  const files = input.files ?? [];
  if (!body && files.length === 0) {
    throw new AppError("VALIDATION_ERROR", 400, "Informe um texto (body) ou ao menos um arquivo (medias)");
  }
  const items: OutgoingItem[] = [];
  if (files.length === 0) items.push({ body, media: null });
  for (const [i, file] of files.entries()) {
    const media = await saveBuffer(connection.companyId, file.buffer, file.mimetype, file.originalname || null);
    // O texto vai como legenda do primeiro arquivo.
    items.push({ body: i === 0 ? body : "", media });
  }
  return sendToTicket(connection, input.number, items);
}

export async function sendMediaUrl(
  connection: Connection,
  input: { number: string; url: string; caption?: string; fileName?: string },
) {
  assertConnected(connection);
  const remote = await fetchRemoteMedia(input.url);
  const media = await saveBuffer(connection.companyId, remote.buffer, remote.mime, input.fileName || remote.name);
  return sendToTicket(connection, input.number, [{ body: input.caption?.trim() ?? "", media }]);
}
