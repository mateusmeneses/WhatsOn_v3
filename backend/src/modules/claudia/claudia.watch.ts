import { literal, Op } from "sequelize";
import { Ticket } from "../../models";
import { logger } from "../../shared/logger";
import { claudiaConfig, ClaudiaEvent, ClaudiaPayload, enqueueGrouped, markOnce, ticketPayload } from "./claudia.webhook";

const BATCH = 500;
export const BOT_STUCK_MINUTES = 3;
export const TRANSFER_MARKS = [10, 20];
export const IDLE_MARKS = [15, 30];
/** Esperas bem mais antigas que o último marco (ex.: na primeira subida) não geram aviso atrasado. */
const STALE_AFTER_MINUTES = 30;

/** Quando a conversa foi transferida (pelo técnico ou pelo bot) para quem ainda não aceitou. */
const transferredAt = literal(
  `(SELECT MAX(l."createdAt") FROM ticket_logs l WHERE l."ticketId" = "Ticket"."id" AND l."event" = 'transferred')`,
);

/** Última mensagem da conversa foi nossa (da Claudia): quem está devendo resposta é o cliente. */
const lastMessageFromUs = literal(
  `(SELECT m."fromMe" FROM messages m WHERE m."ticketId" = "Ticket"."id" ORDER BY m."createdAt" DESC, m."id" DESC LIMIT 1) = true`,
);
const lastMessageAt = literal(`(SELECT MAX(m."createdAt") FROM messages m WHERE m."ticketId" = "Ticket"."id")`);

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

const minutesSince = (since: Date, now: Date) => Math.floor((now.getTime() - since.getTime()) / 60_000);

/**
 * Maior marco já alcançado desde `since` que ainda não foi avisado. Marcos menores que ficaram para trás
 * (worker parado) não são mandados atrasados: só o mais recente vale.
 */
async function reachedMark(evento: ClaudiaEvent, ticketId: number, since: Date, now: Date, marks: number[]): Promise<number | null> {
  const elapsed = minutesSince(since, now);
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

/**
 * Varredura de minuto em minuto dos avisos por tempo: bot parado há 3 min, transferência sem aceite
 * (10 e 20 min) e cliente sem responder à Claudia (15 e 30 min). Cada marco sai uma vez só.
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

  const transfers = await Ticket.findAll({
    where: { companyId: cfg.companyId, status: "pending", userId: { [Op.ne]: null } },
    attributes: ["id", [transferredAt, "transferredAt"]],
    limit: BATCH,
  });
  await each(transfers, async (t) => {
    const since = toDate(t.get("transferredAt"));
    if (!since) return false;
    const mark = await reachedMark("transferencia_sem_aceite", t.id, since, now, TRANSFER_MARKS);
    return mark !== null && send("transferencia_sem_aceite", t.id, { minutos_sem_aceite: mark }, now);
  });

  if (cfg.userId !== null) {
    const idle = await Ticket.findAll({
      where: { companyId: cfg.companyId, status: "open", userId: cfg.userId, [Op.and]: [lastMessageFromUs] },
      attributes: ["id", [lastMessageAt, "lastAt"]],
      limit: BATCH,
    });
    await each(idle, async (t) => {
      const since = toDate(t.get("lastAt"));
      if (!since) return false;
      const mark = await reachedMark("inatividade_cliente", t.id, since, now, IDLE_MARKS);
      return mark !== null && send("inatividade_cliente", t.id, { minutos_sem_resposta: mark }, now);
    });
  }
  return sent;
}
