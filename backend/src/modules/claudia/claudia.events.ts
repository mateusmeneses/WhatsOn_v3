import { Op } from "sequelize";
import { env } from "../../config/env";
import { Company, Connection, ConnectionStatus, Contact, Message, Queue, Ticket } from "../../models";
import { getQueue, QueueNames } from "../../queues";
import { logger } from "../../shared/logger";
import { getRedis } from "../../shared/redis";
import { createOutgoingMessage } from "../messages/messages.service";
import { isOpen } from "../queues/schedule";
import { closeTicketInternal } from "../tickets/tickets.service";
import { CONNECTION_ALERT_JOB, ConnectionAlertData } from "./claudia.alerts";
import { onlyReaction } from "./claudia.v2";
import {
  ClaudiaConfig,
  ClaudiaEvent,
  claudiaFor,
  connectionPayload,
  enqueueClaudia,
  enqueueGrouped,
  isWatchedNumber,
  markOnce,
  primaryEvent,
  ticketPayload,
  TIME_ZONE,
} from "./claudia.webhook";

/** Aviso à Claudia nunca pode atrapalhar o atendimento: qualquer falha só vai para o log. */
async function safely<T>(what: string, ticketId: number | null, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.warn({ err, ticketId }, `falha ao preparar aviso à Claudia (${what})`);
    return fallback;
  }
}

/** Um aviso com todos os eventos (o principal em `evento`, a lista em `eventos`). */
async function sendTicketEvents(events: ClaudiaEvent[], ticketId: number): Promise<void> {
  const payload = await ticketPayload(primaryEvent(events), ticketId);
  if (!payload) return;
  if (events.length > 1) payload.eventos = events;
  await enqueueGrouped(payload);
  if (events.includes("conversa_aguardando")) await markAwaitingNotified(ticketId);
}

const awaitingKey = (ticketId: number) => `claudia:aguardando:${ticketId}`;

/** v2: conversa_aguardando acabou de sair; mensagens seguintes da conversa ainda sem atendente não geram outro aviso. */
async function markAwaitingNotified(ticketId: number): Promise<void> {
  const cfg = claudiaFor((await Ticket.findByPk(ticketId, { attributes: ["companyId"] }))?.companyId ?? -1);
  await getRedis().set(awaitingKey(ticketId), "1", "PX", cfg?.awaitingWindowMs ?? 60_000);
}

/** Conversa aguardando, sem atendente, com a fila fora do expediente agora. */
async function waitingOutOfHours(ticket: Pick<Ticket, "id" | "companyId" | "status" | "userId" | "queueId">): Promise<boolean> {
  if (ticket.status !== "pending" || ticket.userId !== null) return false;
  const [queue, company] = await Promise.all([
    ticket.queueId ? Queue.findByPk(ticket.queueId, { attributes: ["id", "schedule"] }) : null,
    Company.findByPk(ticket.companyId, { attributes: ["id", "timezone"] }),
  ]);
  return !isOpen(queue?.schedule, new Date(), company?.timezone ?? TIME_ZONE);
}

/**
 * CLAUDIA_AUTO_FORA_HORARIO: conversa aguardando fora do expediente não acorda a Claudia; fica em Aguardando e o
 * cliente recebe (uma vez) a mensagem de horário. `sendText` false quando o bot já mandou a dele.
 */
async function handledOutOfHours(cfg: ClaudiaConfig, ticket: Ticket, sendText: boolean): Promise<boolean> {
  if (!cfg.autoOutOfHours || !(await waitingOutOfHours(ticket))) return false;
  if (sendText && (await markOnce(`fora-horario:${ticket.id}`))) {
    const text = cfg.outOfHoursText ?? (await Connection.findByPk(ticket.connectionId))?.outOfHoursMessage ?? "";
    if (text.trim()) await createOutgoingMessage(ticket, { body: text, isBot: true });
  }
  return true;
}

/** Conversa devolvida pelo bot para Aguardando (as novas sem bot saem em claudiaOnClientMessage). */
export function claudiaOnAwaiting(ticket: Ticket): Promise<void> {
  return safely("conversa_aguardando", ticket.id, undefined, async () => {
    const cfg = claudiaFor(ticket.companyId);
    if (!cfg) return;
    // O bot já mandou a mensagem de fora do horário ao transferir para fila fechada.
    if (await handledOutOfHours(cfg, ticket, false)) return;
    await sendTicketEvents(["conversa_aguardando"], ticket.id);
  });
}

/** Conversa transferida para a Claudia: avisa na hora (antes só vinha transferencia_sem_aceite depois de 10 min). */
export function claudiaOnTransfer(ticket: Pick<Ticket, "id" | "companyId" | "userId">): Promise<void> {
  return safely("transferida_para_claudia", ticket.id, undefined, async () => {
    const cfg = claudiaFor(ticket.companyId);
    if (!cfg || cfg.userId === null || ticket.userId !== cfg.userId) return;
    await sendTicketEvents(["transferida_para_claudia"], ticket.id);
  });
}

/** Cliente respondeu algo que o bot não entendeu ("Opção inválida"). */
export function claudiaOnBotInvalid(ticket: Pick<Ticket, "id" | "companyId">): Promise<void> {
  return safely("bot_parado", ticket.id, undefined, async () => {
    if (!claudiaFor(ticket.companyId)) return;
    await sendTicketEvents(["bot_parado"], ticket.id);
  });
}

const POST_CLOSE_WINDOW_MS = 24 * 3600_000;

async function closedRecently(ticket: Ticket): Promise<boolean> {
  const count = await Ticket.count({
    where: {
      id: { [Op.ne]: ticket.id },
      contactId: ticket.contactId,
      connectionId: ticket.connectionId,
      status: "closed",
      closedAt: { [Op.gte]: new Date(Date.now() - POST_CLOSE_WINDOW_MS) },
    },
  });
  return count > 0;
}

/**
 * Mensagem do cliente (nunca nossa: as da Claudia, dos técnicos e as automáticas do sistema saem como fromMe).
 * Contato robô → nada. Número vigiado → só mensagem_mateus; conversa nova que já entrou em Aguardando (sem bot) →
 * conversa_aguardando; conversa com a Claudia → mensagem_cliente; conversa nova até 24 h depois de outra finalizada →
 * mensagem_pos_finalizacao. No v2 também mensagem_cliente em conversa aguardando sem atendente (salvo logo depois do
 * conversa_aguardando dela), e os eventos da mesma mensagem saem num aviso só.
 *
 * Devolve true quando a conversa foi resolvida aqui (CLAUDIA_AUTO_REACAO: só "obrigado"/👍 depois de finalizar →
 * finalizada de novo, sem mensagem): quem chamou não deve mais passar a mensagem pelo bot.
 */
export function claudiaOnClientMessage(
  ticket: Ticket,
  contact: Contact,
  created: boolean,
  message: Pick<Message, "type" | "body">,
): Promise<boolean> {
  return safely("mensagem do cliente", ticket.id, false, async () => {
    const cfg = claudiaFor(ticket.companyId);
    if (!cfg || contact.isRobot) return false;
    if (isWatchedNumber(cfg, contact.number)) {
      await sendTicketEvents(["mensagem_mateus"], ticket.id);
      return false;
    }

    const withClaudia = cfg.userId !== null && ticket.userId === cfg.userId && ticket.status !== "closed";
    const afterClose = created && !withClaudia && (await closedRecently(ticket));
    if (afterClose && cfg.autoReaction && onlyReaction(message)) {
      await closeTicketInternal(ticket, { userId: null, event: "closed", sendClosingMessage: false });
      return true;
    }
    if (await handledOutOfHours(cfg, ticket, true)) return false;

    const events: ClaudiaEvent[] = [];
    if (created && ticket.status === "pending") events.push("conversa_aguardando");
    if (withClaudia) events.push("mensagem_cliente");
    else if (
      cfg.format === "v2" &&
      !created &&
      ticket.status === "pending" &&
      ticket.userId === null &&
      !(await getRedis().exists(awaitingKey(ticket.id)))
    ) {
      events.push("mensagem_cliente");
    }
    if (afterClose) events.push("mensagem_pos_finalizacao");
    if (!events.length) return false;

    if (cfg.format === "v2") await sendTicketEvents(events, ticket.id);
    else for (const evento of events) await sendTicketEvents([evento], ticket.id);
    return false;
  });
}

/**
 * Agenda o aviso de queda (cancelável se voltar no prazo) ou, na volta, cancela o que ainda espera; se a queda já
 * tinha saído, chama `onBack` para avisar a volta.
 */
async function trackDown(
  key: string,
  previous: ConnectionStatus,
  state: ConnectionStatus,
  scheduleDown: () => Promise<string>,
  onBack: () => Promise<void>,
): Promise<void> {
  if (previous === "connected") {
    if (await getRedis().exists(key)) return;
    await getRedis().set(key, await scheduleDown());
  } else if (state === "connected") {
    const jobId = await getRedis().getdel(key);
    if (!jobId) return;
    const pending = await getQueue(QueueNames.claudiaWebhook).getJob(jobId);
    // Ainda na espera: cancela e não avisa nada. Se já saiu (ou está saindo agora), avisa a volta.
    const cancelled = pending && (await pending.isDelayed()) && (await pending.remove().then(() => true, () => false));
    if (!cancelled) await onBack();
  }
}

/**
 * Conexão com o WhatsApp caiu (fora, só se não voltar no prazo: 2 min no v1, CLAUDIA_CONEXAO_MINUTOS no v2) ou voltou
 * depois de um aviso de queda que chegou a sair (voltou). Queda curta não gera aviso nenhum. Com ALERTA_CONEXAO_DESTINOS,
 * as pessoas recebem o alerta direto por WhatsApp (mesmo no modo econômico, que não acorda a Claudia por conexão).
 */
export function claudiaOnConnectionChange(
  connection: Connection,
  previous: ConnectionStatus,
  state: ConnectionStatus,
): Promise<void> {
  return safely("conexao", null, undefined, async () => {
    const cfg = claudiaFor(connection.companyId);
    if (!cfg || previous === state) return;

    if (cfg.connectionAlerts.length) {
      const minutes = env.CLAUDIA_CONEXAO_MINUTOS;
      const alert = async (status: "fora" | "voltou", delay: number): Promise<string> => {
        const data: ConnectionAlertData = { connectionId: connection.id, status, minutes };
        const jobId = `alerta-conexao-${connection.id}-${status}-${Date.now()}`;
        await getQueue(QueueNames.claudiaWebhook).add(CONNECTION_ALERT_JOB, data as never, {
          jobId,
          delay,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        });
        return jobId;
      };
      await trackDown(
        `claudia:alerta-conexao:${connection.id}`,
        previous,
        state,
        () => alert("fora", minutes * 60_000),
        async () => void (await alert("voltou", 0)),
      );
    }

    // Modo econômico: a Claudia não acorda por conexão.
    if (cfg.economy) return;
    await trackDown(
      `claudia:conexao-fora:${connection.id}`,
      previous,
      state,
      async () => {
        const payload = connectionPayload("fora");
        await enqueueClaudia(payload, cfg.connectionGraceMs);
        return payload.id_evento;
      },
      () => enqueueClaudia(connectionPayload("voltou")),
    );
  });
}
