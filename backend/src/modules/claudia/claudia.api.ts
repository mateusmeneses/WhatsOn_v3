import { env } from "../../config/env";
import { Connection, Queue, Ticket, User } from "../../models";
import { AppError } from "../../shared/errors/AppError";
import { AuthContext } from "../auth/auth.types";
import { listMessages, sendAgentMessage } from "../messages/agentMessages.service";
import { onlineUsers } from "../realtime/socket";
import { acceptTicket, closeTicket, getVisibleTicket, transferTicket, updateTicketNotes } from "../tickets/tickets.service";
import { attachmentKind, attendants, origin, STATUS } from "./claudia.v2";
import { claudiaFor, ClaudiaConfig, isoWithOffset, MESSAGE_TYPES, TIME_ZONE } from "./claudia.webhook";

/**
 * API de ações da Claudia (/api/v1/conversas/…): mesmo token de API das conexões, só na empresa da Claudia, e toda
 * ação é feita como o usuário CLAUDIA_USER_ID (histórico, assinatura e permissões dele).
 */
export async function claudiaAuth(connection: Connection): Promise<{ auth: AuthContext; cfg: ClaudiaConfig }> {
  const cfg = claudiaFor(connection.companyId);
  if (!cfg || cfg.userId === null) throw new AppError("NOT_FOUND", 404, "API da Claudia não está ativa nesta empresa");
  const user = await User.findOne({ where: { id: cfg.userId, companyId: connection.companyId }, attributes: ["id", "profile"] });
  if (!user) throw new AppError("CLAUDIA_USER_NOT_FOUND", 404, "Usuário da Claudia (CLAUDIA_USER_ID) não existe nesta empresa");
  return { auth: { userId: user.id, companyId: connection.companyId, profile: user.profile }, cfg };
}

/** Estado final da conversa, para a Claudia confirmar sem reabrir o painel. */
export async function conversationState(id: number) {
  const ticket = await Ticket.findByPk(id, {
    attributes: ["id", "status", "userId", "queueId", "closedAt"],
    include: [
      { model: Queue, attributes: ["id", "name"] },
      { model: User, attributes: ["id", "name"] },
    ],
  });
  if (!ticket) throw new AppError("NOT_FOUND", 404, "Conversa não encontrada");
  return {
    id: ticket.id,
    status: STATUS[ticket.status] ?? ticket.status,
    fila: ticket.queue ? { id: ticket.queue.id, nome: ticket.queue.name } : null,
    atendente: ticket.user ? { id: ticket.user.id, nome: ticket.user.name } : null,
  };
}

export async function apiAccept(auth: AuthContext, id: number) {
  await acceptTicket(auth, id);
  return { conversa: await conversationState(id) };
}

export async function apiSendMessage(auth: AuthContext, id: number, input: { texto: string; assinar?: boolean }) {
  const message = await sendAgentMessage(auth, id, { body: input.texto, sign: input.assinar });
  return {
    mensagem: { id: message.id, em: isoWithOffset(message.createdAt, TIME_ZONE), status_envio: message.ack },
    conversa: await conversationState(id),
  };
}

export async function apiListMessages(cfg: ClaudiaConfig, auth: AuthContext, id: number, limit: number) {
  const { items, hasMore } = await listMessages(auth, id, { limit });
  return {
    mensagens: items.map((m) => ({
      id: m.id,
      em: isoWithOffset(m.createdAt, TIME_ZONE),
      origem: origin(cfg, m),
      tipo: MESSAGE_TYPES[m.type] ?? m.type,
      texto: m.deletedAt ? null : m.body || null,
      apagada: Boolean(m.deletedAt),
      anexo: m.mediaUrl ? { tipo: attachmentKind(m), nome: m.mediaName, url: `${env.BACKEND_PUBLIC_URL}${m.mediaUrl}` } : null,
    })),
    mais_antigas: hasMore,
  };
}

export async function apiNotes(auth: AuthContext, id: number) {
  const ticket = await getVisibleTicket(auth, id);
  return { observacoes: ticket.notes };
}

const NOTES_MAX = 5000;

/** Acrescenta (nunca apaga) uma linha datada e assinada às Observações. */
export async function apiAppendNote(auth: AuthContext, id: number, texto: string, now = new Date()) {
  const ticket = await getVisibleTicket(auth, id);
  const user = await User.findByPk(auth.userId, { attributes: ["name"] });
  const stamp = isoWithOffset(now, TIME_ZONE).slice(0, 16).replace("T", " ");
  const line = `[${stamp}] ${user?.name ?? "Claudia"}: ${texto.trim()}`;
  const notes = ticket.notes.trim() ? `${ticket.notes.trimEnd()}\n${line}` : line;
  if (notes.length > NOTES_MAX) throw new AppError("NOTES_TOO_LONG", 422, `Observações passariam de ${NOTES_MAX} caracteres`);
  await updateTicketNotes(auth, id, notes);
  return { observacoes: notes };
}

/** Transfere para um atendente (só se estiver logado no painel agora) ou para uma fila. */
export async function apiTransfer(auth: AuthContext, id: number, input: { usuario_id?: number; fila_id?: number }) {
  if (input.usuario_id) {
    const target = await User.findOne({ where: { id: input.usuario_id, companyId: auth.companyId }, attributes: ["id", "name"] });
    if (!target) throw new AppError("USER_NOT_FOUND", 404, "Atendente não encontrado");
    const online = new Set((await onlineUsers(auth.companyId)).map((u) => u.userId));
    if (!online.has(target.id)) throw new AppError("USUARIO_OFFLINE", 409, `${target.name} não está logado no WhatsOn agora`);
  }
  await transferTicket(auth, id, { userId: input.usuario_id, queueId: input.fila_id });
  return { conversa: await conversationState(id) };
}

export async function apiClose(auth: AuthContext, id: number, sendClosingMessage: boolean) {
  await closeTicket(auth, id, { sendClosingMessage });
  return { conversa: await conversationState(id) };
}

export async function apiPresence(cfg: ClaudiaConfig, companyId: number) {
  return { atendentes: await attendants(cfg, companyId) };
}
