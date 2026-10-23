import { literal, Op } from "sequelize";
import { env } from "../../config/env";
import { Company, Contact, Queue, Ticket, User } from "../../models";
import { logger } from "../../shared/logger";
import { businessMinutesBetween } from "../queues/schedule";
import { emitter, rooms } from "../realtime/socket";
import { sendTextToUser } from "../users/whatsappNotify";

/** Estágios: 1 = som e pop-up; 2 e 3 = também WhatsApp ao técnico; 4 = também avisa supervisores e admins. */
export const IDLE_ALERT_LEVELS = 4;
const BATCH = 500;

/** Última mensagem do atendimento foi do cliente: quem está devendo resposta é o técnico. */
const lastMessageFromClient = literal(
  `(SELECT m."fromMe" FROM messages m WHERE m."ticketId" = "Ticket"."id" ORDER BY m."createdAt" DESC, m."id" DESC LIMIT 1) = false`,
);

/** Primeira mensagem do cliente depois da nossa última: mensagens seguidas do cliente não reiniciam a espera. */
const waitingSince = literal(
  `(SELECT MIN(m."createdAt") FROM messages m WHERE m."ticketId" = "Ticket"."id" AND m."fromMe" = false AND m."createdAt" > ` +
    `COALESCE((SELECT MAX(o."createdAt") FROM messages o WHERE o."ticketId" = "Ticket"."id" AND o."fromMe" = true), 'epoch'))`,
);

/** Quando o técnico atual assumiu: transferência ou requisição recomeçam a contagem para quem recebeu. */
const assignedAt = literal(
  `(SELECT MAX(l."createdAt") FROM ticket_logs l WHERE l."ticketId" = "Ticket"."id" AND l."event" IN ('accepted', 'transferred', 'claimed', 'reopened'))`,
);

export interface IdleAlertPayload {
  ticketId: number;
  contactName: string;
  agentName: string;
  minutes: number;
  level: number;
  /** true no aviso que vai para supervisores e admins. */
  escalated: boolean;
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function agentText(p: IdleAlertPayload): string {
  const head =
    p.level >= IDLE_ALERT_LEVELS ? "🚨 WhatsOn — a supervisão foi avisada" : p.level === 3 ? "⚠️ WhatsOn — URGENTE" : "⏰ WhatsOn";
  return [
    head,
    `O cliente ${p.contactName} está sem resposta há ${p.minutes} min no seu atendimento #${p.ticketId}.`,
    "Responda ou finalize o atendimento:",
    `${env.FRONTEND_URL}/atendimento/${p.ticketId}`,
  ].join("\n");
}

export function supervisorText(p: IdleAlertPayload): string {
  return [
    "🚨 WhatsOn — atendimento sem resposta",
    `O cliente ${p.contactName} está há ${p.minutes} min sem resposta no atendimento #${p.ticketId}, com ${p.agentName}.`,
    `${env.FRONTEND_URL}/atendimento/${p.ticketId}`,
  ].join("\n");
}

async function notify(ticket: Ticket, agent: User, payload: IdleAlertPayload): Promise<void> {
  emitter.toRooms([rooms.user(agent.id)], "ticket:idle-alert", payload);
  if (payload.level >= 2) await sendTextToUser(agent, agentText(payload));
  if (payload.level < IDLE_ALERT_LEVELS) return;

  const escalated = { ...payload, escalated: true };
  emitter.toRooms([rooms.supervisors(ticket.companyId)], "ticket:idle-alert", escalated);
  const supervisors = await User.findAll({
    where: { companyId: ticket.companyId, profile: { [Op.in]: ["admin", "supervisor"] }, id: { [Op.ne]: agent.id } },
  });
  for (const supervisor of supervisors) await sendTextToUser(supervisor, supervisorText(escalated));
}

/**
 * Avisa o técnico, em estágios a cada `idleAlertMinutes` de expediente da fila, quando o cliente está esperando
 * resposta num atendimento em andamento. No último estágio avisa também supervisores e admins. Cada estágio dispara
 * uma vez por espera; resposta, transferência ou fim do atendimento encerram a espera.
 */
export async function sendIdleAlerts(now = new Date()): Promise<number> {
  const companies = await Company.findAll({
    where: { idleAlertMinutes: { [Op.gt]: 0 }, status: { [Op.ne]: "blocked" } },
    attributes: ["id", "idleAlertMinutes", "timezone"],
  });
  let sent = 0;
  for (const company of companies) {
    const tickets = await Ticket.findAll({
      where: { companyId: company.id, status: "open", userId: { [Op.ne]: null }, [Op.and]: [lastMessageFromClient] },
      attributes: { include: [[waitingSince, "waitingSince"], [assignedAt, "assignedAt"]] },
      include: [
        { model: Contact, attributes: ["id", "name"] },
        { model: Queue, attributes: ["id", "schedule"] },
        { model: User, attributes: ["id", "name", "phone", "companyId"] },
      ],
      order: [["lastMessageAt", "ASC"]],
      limit: BATCH,
    });
    for (const ticket of tickets) {
      try {
        const waiting = toDate(ticket.get("waitingSince"));
        if (!waiting || !ticket.user) continue;
        const assigned = toDate(ticket.get("assignedAt"));
        const since = assigned && assigned > waiting ? assigned : waiting;
        const sameWait = ticket.idleAlertSince?.getTime() === since.getTime();
        const current = sameWait ? ticket.idleAlertLevel : 0;
        const minutes = businessMinutesBetween(ticket.queue?.schedule, since, now, company.timezone);
        const level = Math.min(IDLE_ALERT_LEVELS, Math.floor(minutes / company.idleAlertMinutes));
        if (level <= current) continue;

        // Marca antes de avisar e só se ninguém marcou no meio: dois workers não duplicam o aviso.
        const [claimed] = await Ticket.update(
          { idleAlertLevel: level, idleAlertSince: since },
          {
            where: { id: ticket.id, idleAlertLevel: ticket.idleAlertLevel, idleAlertSince: ticket.idleAlertSince },
            silent: true,
          },
        );
        if (!claimed) continue;
        await notify(ticket, ticket.user, {
          ticketId: ticket.id,
          contactName: ticket.contact?.name ?? "sem nome",
          agentName: ticket.user.name,
          minutes,
          level,
          escalated: false,
        });
        sent += 1;
      } catch (err) {
        logger.error({ err, ticketId: ticket.id }, "failed to send idle alert");
      }
    }
  }
  return sent;
}
