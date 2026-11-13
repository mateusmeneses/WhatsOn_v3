import { literal, Op } from "sequelize";
import { env } from "../../config/env";
import { ClaudiaEventLog, Company, Contact, Queue, Ticket, User } from "../../models";
import { logger } from "../../shared/logger";
import { getRedis } from "../../shared/redis";
import { createOutgoingMessage } from "../messages/messages.service";
import { businessMinutesBetween } from "../queues/schedule";
import { onlineUsers } from "../realtime/socket";
import { lastHumanMessageAt, lastHumanMessageFromUs } from "../tickets/inactivity";
import { closeTicketInternal } from "../tickets/tickets.service";
import { sendAlert } from "./claudia.alerts";
import {
  claudiaConfig,
  ClaudiaConfig,
  ClaudiaEvent,
  ClaudiaPayload,
  enqueueGrouped,
  markOnce,
  ticketPayload,
  TIME_ZONE,
} from "./claudia.webhook";

const BATCH = 500;
export const BOT_STUCK_MINUTES = 3;
export const TRANSFER_MARKS = [10, 20];
export const IDLE_MARKS = [15, 30];
/** Esperas bem mais antigas que o último marco (ex.: na primeira subida) não geram aviso atrasado. */
const STALE_AFTER_MINUTES = 30;
/** Avisos guardados (claudia_events) ficam este tempo para GET /api/v1/webhook/eventos. */
export const EVENTS_RETENTION_DAYS = 30;

/** Quando a conversa foi transferida (pelo técnico ou pelo bot) para quem ainda não aceitou. */
const transferredAt = literal(
  `(SELECT MAX(l."createdAt") FROM ticket_logs l WHERE l."ticketId" = "Ticket"."id" AND l."event" = 'transferred')`,
);
/** Última mensagem humana é do cliente: o suporte deve a resposta. */
const clientWaiting = literal(
  `COALESCE((SELECT m."fromMe" FROM messages m WHERE m."ticketId" = "Ticket"."id" AND m."isBot" = false ` +
    `ORDER BY m."createdAt" DESC, m."id" DESC LIMIT 1) = false, false)`,
);
/** Reabrir, aceitar ou receber a conversa recomeça a contagem de inatividade (mensagem antiga não conta). */
const restartedAt = literal(
  `(SELECT MAX(l."createdAt") FROM ticket_logs l WHERE l."ticketId" = "Ticket"."id" AND l."event" IN ('reopened', 'accepted', 'transferred', 'claimed'))`,
);

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

const minutesSince = (since: Date, now: Date) => Math.floor((now.getTime() - since.getTime()) / 60_000);

/**
 * Maior marco já alcançado (em `elapsed` minutos desde `since`) que ainda não foi avisado. Marcos menores que ficaram
 * para trás (worker parado) não são mandados atrasados: só o mais recente vale.
 */
async function reachedMark(evento: ClaudiaEvent, ticketId: number, since: Date, elapsed: number, marks: number[]): Promise<number | null> {
  const reached = marks.filter((m) => elapsed >= m);
  if (!reached.length) return null;
  const mark = Math.max(...reached);
  if (elapsed >= mark + STALE_AFTER_MINUTES) return null;
  const fresh = await markOnce(`${evento}:${ticketId}:${since.getTime()}:${mark}`);
  return fresh ? mark : null;
}

async function send(evento: ClaudiaEvent, ticketId: number, extra: Partial<ClaudiaPayload> = {}, now: Date): Promise<boolean> {
  const payload = await ticketPayload(evento, ticketId, extra, now);
  if (!payload) return false;
  await enqueueGrouped(payload);
  return true;
}

/** Uma vez por hora: apaga avisos guardados mais antigos que a retenção. */
async function pruneEvents(now: Date): Promise<void> {
  if ((await getRedis().set("claudia:prune", "1", "EX", 3600, "NX")) !== "OK") return;
  await ClaudiaEventLog.destroy({
    where: { createdAt: { [Op.lt]: new Date(now.getTime() - EVENTS_RETENTION_DAYS * 24 * 3600_000) } },
  });
}

export function noAcceptText(t: { id: number; contact: string; technician: string; minutes: number }): string {
  return [
    `⏰ WhatsOn — atendimento #${t.id} (${t.contact}) transferido para ${t.technician} e sem aceite há ${t.minutes} min.`,
    `${env.FRONTEND_URL}/atendimento/${t.id}`,
  ].join("\n");
}

/**
 * Sem aceite com alerta direto (ALERTA_SEM_ACEITE_DESTINOS + CLAUDIA_ALERTA_TECNICOS): avisa as pessoas só se a
 * conversa é de um desses técnicos, ele está online e o cliente espera resposta. Nunca acorda a Claudia.
 */
async function alertNoAccept(cfg: ClaudiaConfig, t: Ticket, mark: number, online: Set<number>): Promise<boolean> {
  if (t.userId === null || !cfg.alertTechnicians.includes(t.userId) || !online.has(t.userId)) return false;
  if (!t.get("clientWaiting")) return false;
  const text = noAcceptText({ id: t.id, contact: t.contact?.name ?? "sem nome", technician: t.user?.name ?? "técnico", minutes: mark });
  return (await sendAlert(cfg.companyId, cfg.noAcceptAlerts, text)) > 0;
}

/**
 * Varredura de minuto em minuto dos avisos por tempo: bot parado há 3 min, transferência sem aceite
 * (10 e 20 min contados só no expediente da fila) e cliente sem responder à Claudia (15 e 30 min).
 * Cada marco sai uma vez só. Com as automações ligadas, o sistema resolve sozinho (lembrete/finalização, alerta
 * direto) em vez de acordar a Claudia.
 */
export async function runClaudiaWatch(now = new Date()): Promise<number> {
  const cfg = claudiaConfig();
  if (!cfg) return 0;
  let sent = 0;
  const each = async (tickets: Ticket[], fn: (t: Ticket) => Promise<boolean>) => {
    for (const ticket of tickets) {
      try {
        if (await fn(ticket)) sent += 1;
      } catch (err) {
        logger.error({ err, ticketId: ticket.id }, "falha na varredura de avisos à Claudia");
      }
    }
  };

  const stuck = await Ticket.findAll({
    where: {
      companyId: cfg.companyId,
      status: "bot",
      lastMessageAt: {
        [Op.lte]: new Date(now.getTime() - BOT_STUCK_MINUTES * 60_000),
        [Op.gt]: new Date(now.getTime() - (BOT_STUCK_MINUTES + STALE_AFTER_MINUTES) * 60_000),
      },
    },
    attributes: ["id", "lastMessageAt"],
    limit: BATCH,
  });
  await each(stuck, async (t) => {
    if (!t.lastMessageAt || !(await markOnce(`bot_parado:${t.id}:${t.lastMessageAt.getTime()}`))) return false;
    return send("bot_parado", t.id, {}, now);
  });

  const company = await Company.findByPk(cfg.companyId, { attributes: ["id", "timezone", "inactivityCloseMessage"] });
  const timeZone = company?.timezone ?? TIME_ZONE;
  const direct = cfg.noAcceptAlerts.length > 0 && cfg.alertTechnicians.length > 0;
  const transfers = await Ticket.findAll({
    where: { companyId: cfg.companyId, status: "pending", userId: { [Op.ne]: null } },
    attributes: ["id", "userId", [transferredAt, "transferredAt"], [clientWaiting, "clientWaiting"]],
    include: [
      { model: Queue, attributes: ["id", "schedule"] },
      { model: Contact, attributes: ["id", "name"] },
      { model: User, attributes: ["id", "name"] },
    ],
    limit: BATCH,
  });
  const online = direct && transfers.length ? new Set((await onlineUsers(cfg.companyId)).map((u) => u.userId)) : new Set<number>();
  await each(transfers, async (t) => {
    const since = toDate(t.get("transferredAt"));
    if (!since) return false;
    // Só conta no expediente da fila (horário de técnicos); fila sem horário = o tempo todo.
    const elapsed = businessMinutesBetween(t.queue?.schedule, since, now, timeZone);
    const mark = await reachedMark("transferencia_sem_aceite", t.id, since, elapsed, TRANSFER_MARKS);
    if (mark === null) return false;
    if (direct) return alertNoAccept(cfg, t, mark, online);
    return send("transferencia_sem_aceite", t.id, { minutos_sem_aceite: mark }, now);
  });

  if (cfg.userId !== null) {
    const idle = await Ticket.findAll({
      where: { companyId: cfg.companyId, status: "open", userId: cfg.userId, [Op.and]: [lastHumanMessageFromUs] },
      attributes: { include: [[lastHumanMessageAt, "lastAt"], [restartedAt, "restartedAt"]] },
      limit: BATCH,
    });
    await each(idle, async (t) => {
      const last = toDate(t.get("lastAt"));
      if (!last) return false;
      const restarted = toDate(t.get("restartedAt"));
      const since = restarted && restarted > last ? restarted : last;
      const mark = await reachedMark("inatividade_cliente", t.id, since, minutesSince(since, now), IDLE_MARKS);
      if (mark === null) return false;
      if (!cfg.autoInactivity) return send("inatividade_cliente", t.id, { minutos_sem_resposta: mark }, now);
      // Automático: lembrete no primeiro marco, finaliza no último; a Claudia não é acordada.
      if (mark < Math.max(...IDLE_MARKS)) {
        await createOutgoingMessage(t, { body: cfg.reminderText, isBot: true });
        return true;
      }
      return closeTicketInternal(t, {
        userId: null,
        event: "inactivity",
        sendClosingMessage: true,
        closingMessage: cfg.inactivityText ?? company?.inactivityCloseMessage ?? "",
        idleSince: since,
      });
    });
  }

  await pruneEvents(now).catch((err) => logger.warn({ err }, "falha ao apagar avisos antigos da Claudia"));
  return sent;
}
