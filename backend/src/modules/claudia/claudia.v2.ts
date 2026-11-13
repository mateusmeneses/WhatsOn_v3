import { Op } from "sequelize";
import { ClaudiaEventLog, Company, Contact, Message, Queue, Ticket, TicketLog, TicketStatus, User } from "../../models";
import { BOT_PATH_SEPARATOR } from "../chatbot/engine";
import { isOpen } from "../queues/schedule";
import { onlineUsers } from "../realtime/socket";
import type { ClaudiaConfig, ClaudiaEvent, ClaudiaPayload } from "./claudia.webhook";
import { isoWithOffset, MESSAGE_TYPES, TIME_ZONE } from "./claudia.webhook";

/** Nomes do formato v2 (requisitos de 28/10) para os eventos que mudaram de nome. */
const V2_NAMES: Partial<Record<ClaudiaEvent, string>> = {
  mensagem_mateus: "mensagem_numero_especial",
  conexao: "conexao_prolongada",
};
export const v2EventName = (e: ClaudiaEvent): string => V2_NAMES[e] ?? e;

export const STATUS: Record<TicketStatus, string> = {
  bot: "bot",
  pending: "aguardando",
  open: "atendendo",
  closed: "finalizado",
  group: "grupo",
};

const MAX_RECENT = 5;

/** Palavras de quem só agradece/confirma ("obrigado", "ok", "valeu"), já sem acento. */
const THANKS = new Set([
  "ok", "okay", "obrigado", "obrigada", "obrigados", "obrigadas", "brigado", "brigada", "obg", "valeu", "vlw", "blz",
  "beleza", "show", "top", "certo", "perfeito", "grato", "grata", "tmj", "muito", "mt", "mto", "agradeco", "otimo",
  "joia", "certinho", "combinado",
]);

/** Mensagem que é só reação: figurinha, emoji, ou agradecimento/confirmação curto. */
export function onlyReaction(m: Pick<Message, "type" | "body">): boolean {
  if (m.type === "sticker") return true;
  if (m.type !== "text") return false;
  const words = m.body
    .normalize("NFD")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\p{M}\p{Cf}\p{Extended_Pictographic}\s]+/gu, " ")
    .trim();
  return !words || words.split(" ").every((w) => THANKS.has(w));
}

export function origin(cfg: ClaudiaConfig, m: Message): string {
  if (!m.fromMe) return "cliente";
  if (m.isBot) return "bot";
  if (m.sentByUserId !== null && m.sentByUserId === cfg.userId) return "claudia";
  if (m.sentByUserId !== null) return "atendente";
  return "sistema";
}

/** Últimas mensagens desde o aviso anterior da conversa (1 a 5); sem texto se CLAUDIA_WEBHOOK_INCLUIR_TEXTO=false. */
async function recentMessages(cfg: ClaudiaConfig, ticketId: number, eventId: string) {
  const previous = await ClaudiaEventLog.findOne({
    where: { ticketId, eventId: { [Op.ne]: eventId } },
    attributes: ["createdAt"],
    order: [["createdAt", "DESC"]],
  });
  const order: [string, string][] = [
    ["createdAt", "DESC"],
    ["id", "DESC"],
  ];
  let messages = await Message.findAll({
    where: { ticketId, deletedAt: null, ...(previous ? { createdAt: { [Op.gt]: previous.createdAt } } : {}) },
    order,
    limit: MAX_RECENT,
  });
  if (!messages.length) messages = await Message.findAll({ where: { ticketId, deletedAt: null }, order, limit: 1 });
  return messages.reverse().map((m) => ({
    id: m.id,
    em: isoWithOffset(m.createdAt, TIME_ZONE),
    origem: origin(cfg, m),
    tipo: MESSAGE_TYPES[m.type] ?? m.type,
    texto: cfg.includeText ? m.body || null : null,
    anexos: m.mediaUrl ? 1 : 0,
    anexo: m.mediaUrl ? attachmentKind(m) : null,
  }));
}

/** Tipo do anexo pelo MIME, para a Claudia saber se precisa abrir: imagem, audio, video, pdf, figurinha, arquivo. */
export function attachmentKind(m: Pick<Message, "type" | "mediaMime">): string {
  const mime = (m.mediaMime ?? "").toLowerCase();
  if (m.type === "sticker") return "figurinha";
  if (mime === "application/pdf") return "pdf";
  for (const kind of ["image", "audio", "video"] as const) {
    if (mime.startsWith(`${kind}/`) || m.type === kind) return kind === "image" ? "imagem" : kind;
  }
  return "arquivo";
}

/** Atendentes da empresa (menos a Claudia) com presença no painel agora; offline traz quando foi visto. */
export async function attendants(cfg: ClaudiaConfig, companyId: number) {
  const [users, online] = await Promise.all([
    User.findAll({ where: { companyId }, attributes: ["id", "name", "lastSeenAt"], order: [["name", "ASC"]] }),
    onlineUsers(companyId),
  ]);
  const onlineIds = new Set(online.map((o) => o.userId));
  return users
    .filter((u) => u.id !== cfg.userId)
    .map((u) =>
      onlineIds.has(u.id)
        ? { id: u.id, nome: u.name, online: true }
        : { id: u.id, nome: u.name, online: false, visto_em: u.lastSeenAt ? isoWithOffset(u.lastSeenAt, TIME_ZONE) : null },
    );
}

/** Quem deve a resposta: origem da última mensagem humana (bot e avisos automáticos não contam). */
async function lastMessageOrigin(ticketId: number): Promise<"cliente" | "atendente" | null> {
  const last = await Message.findOne({
    where: { ticketId, isBot: false, deletedAt: null },
    attributes: ["fromMe"],
    order: [
      ["createdAt", "DESC"],
      ["id", "DESC"],
    ],
  });
  return last ? (last.fromMe ? "atendente" : "cliente") : null;
}

const NOTES_SUMMARY_CHARS = 500;

/** Desde quando a conversa espera aceite: última entrada em Aguardando (transferência, reabertura) ou a criação. */
async function awaitingSince(ticket: Ticket): Promise<Date> {
  const at = (await TicketLog.max("createdAt", {
    where: { ticketId: ticket.id, event: { [Op.in]: ["created", "transferred", "reopened"] } },
  })) as Date | null;
  return at ? new Date(at) : ticket.createdAt;
}

function emptyBody(cfg: ClaudiaConfig, p: ClaudiaPayload) {
  return {
    evento: v2EventName(p.evento),
    id_evento: p.id_evento,
    ocorrido_em: p.ocorrido_em,
    ambiente: cfg.environment,
    eventos: (p.eventos ?? [p.evento]).map(v2EventName),
    conversa: null as Record<string, unknown> | null,
    contato: null as Record<string, unknown> | null,
    empresa: null as Record<string, unknown> | null,
    mensagens_recentes: [] as Record<string, unknown>[],
    faixa_horario: null as string | null,
    minutos_sem_aceite: p.minutos_sem_aceite ?? null,
    minutos_sem_resposta: p.minutos_sem_resposta ?? null,
    status: p.status ?? null,
    apenas_reacao: null as boolean | null,
    ultima_mensagem_origem: null as string | null,
    observacoes_resumo: null as string | null,
    atendentes_online: null as Record<string, unknown>[] | null,
    conversas: p.conversas ? p.conversas.map((c) => ({ id: c.id, evento: v2EventName(c.evento) })) : null,
  };
}

/**
 * Corpo do formato v2 (seção 4.2 dos requisitos): o necessário para a Claudia decidir sem abrir o painel.
 * Telefone só com os 4 últimos dígitos; texto das mensagens só se configurado.
 */
export async function buildV2Body(cfg: ClaudiaConfig, p: ClaudiaPayload, now = new Date()): Promise<Record<string, unknown>> {
  const body = emptyBody(cfg, p);
  if (p.conversa === null) return body;
  const ticket = await Ticket.findByPk(p.conversa, {
    include: [
      { model: Contact, attributes: ["id", "name", "number", "clientCompany", "managerClientId", "product", "isRobot"] },
      { model: Queue, attributes: ["id", "name", "schedule"] },
      { model: User, attributes: ["id", "name"] },
    ],
  });
  if (!ticket) return body;
  const company = await Company.findByPk(ticket.companyId, { attributes: ["id", "timezone"] });
  const contact = ticket.contact;

  body.conversa = {
    id: ticket.id,
    status: STATUS[ticket.status] ?? ticket.status,
    fila: ticket.queue?.name ?? null,
    menu_escolhido: ticket.botPath ? ticket.botPath.split(BOT_PATH_SEPARATOR) : [],
    atendente: ticket.user?.name ?? null,
    aguardando_desde: ticket.status === "pending" ? isoWithOffset(await awaitingSince(ticket), TIME_ZONE) : null,
  };
  if (contact) {
    body.contato = {
      nome: contact.name,
      telefone_final: contact.number.replace(/\D/g, "").slice(-4),
      cadastrado: Boolean(contact.clientCompany || contact.managerClientId),
      automatico: contact.isRobot,
    };
    if (contact.clientCompany || contact.product) {
      body.empresa = { nome: contact.clientCompany, contrato: null, software: contact.product };
    }
  }
  body.mensagens_recentes = await recentMessages(cfg, ticket.id, p.id_evento);
  body.ultima_mensagem_origem = await lastMessageOrigin(ticket.id);
  const notes = ticket.notes.trim();
  body.observacoes_resumo = notes ? (notes.length > NOTES_SUMMARY_CHARS ? `…${notes.slice(-NOTES_SUMMARY_CHARS)}` : notes) : null;
  body.atendentes_online = await attendants(cfg, ticket.companyId);
  body.faixa_horario = isOpen(ticket.queue?.schedule, now, company?.timezone ?? TIME_ZONE) ? "tecnicos" : "fora";
  if (body.eventos.includes("mensagem_pos_finalizacao")) {
    const fromClient = await Message.findAll({
      where: { ticketId: ticket.id, fromMe: false, deletedAt: null },
      attributes: ["type", "body"],
    });
    body.apenas_reacao = fromClient.length > 0 && fromClient.every(onlyReaction);
  }
  return body;
}
