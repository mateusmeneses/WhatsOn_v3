import { Op } from "sequelize";
import { Connection, ConnectionStatus, Contact, Ticket } from "../../models";
import { logger } from "../../shared/logger";
import { getRedis } from "../../shared/redis";
import {
  ClaudiaEvent,
  claudiaFor,
  connectionPayload,
  enqueueClaudia,
  enqueueGrouped,
  isWatchedNumber,
  ticketPayload,
} from "./claudia.webhook";

/** Aviso à Claudia nunca pode atrapalhar o atendimento: qualquer falha só vai para o log. */
async function safely(what: string, ticketId: number | null, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.warn({ err, ticketId }, `falha ao preparar aviso à Claudia (${what})`);
  }
}

async function sendTicketEvent(evento: ClaudiaEvent, ticketId: number, grouped: boolean): Promise<void> {
  const payload = await ticketPayload(evento, ticketId);
  if (!payload) return;
  await (grouped ? enqueueGrouped(payload) : enqueueClaudia(payload));
}

/** Conversa devolvida pelo bot para Aguardando (as novas sem bot saem em claudiaOnClientMessage). */
export function claudiaOnAwaiting(ticket: Pick<Ticket, "id" | "companyId">): Promise<void> {
  return safely("conversa_aguardando", ticket.id, async () => {
    if (!claudiaFor(ticket.companyId)) return;
    await sendTicketEvent("conversa_aguardando", ticket.id, false);
  });
}

/** Cliente respondeu algo que o bot não entendeu ("Opção inválida"). */
export function claudiaOnBotInvalid(ticket: Pick<Ticket, "id" | "companyId">): Promise<void> {
  return safely("bot_parado", ticket.id, async () => {
    if (!claudiaFor(ticket.companyId)) return;
    await sendTicketEvent("bot_parado", ticket.id, true);
  });
}

const POST_CLOSE_WINDOW_MS = 24 * 3600_000;

/**
 * Mensagem do cliente (nunca nossa: as da Claudia, dos técnicos e as automáticas do sistema saem como fromMe).
 * Número vigiado → só mensagem_mateus; conversa nova que já entrou em Aguardando (sem bot) → conversa_aguardando;
 * conversa com a Claudia → mensagem_cliente; conversa nova até 24 h depois de outra finalizada → mensagem_pos_finalizacao.
 */
export function claudiaOnClientMessage(ticket: Ticket, contact: Contact, created: boolean): Promise<void> {
  return safely("mensagem do cliente", ticket.id, async () => {
    const cfg = claudiaFor(ticket.companyId);
    if (!cfg) return;
    if (isWatchedNumber(cfg, contact.number)) return sendTicketEvent("mensagem_mateus", ticket.id, true);
    if (created && ticket.status === "pending") await sendTicketEvent("conversa_aguardando", ticket.id, false);
    if (cfg.userId !== null && ticket.userId === cfg.userId && ticket.status !== "closed") {
      return sendTicketEvent("mensagem_cliente", ticket.id, true);
    }
    if (!created) return;
    const recentlyClosed = await Ticket.count({
      where: {
        id: { [Op.ne]: ticket.id },
        contactId: ticket.contactId,
        connectionId: ticket.connectionId,
        status: "closed",
        closedAt: { [Op.gte]: new Date(Date.now() - POST_CLOSE_WINDOW_MS) },
      },
    });
    if (recentlyClosed > 0) await sendTicketEvent("mensagem_pos_finalizacao", ticket.id, true);
  });
}

/** Conexão com o WhatsApp caiu (fora) ou voltou depois de um aviso de queda (voltou). */
export function claudiaOnConnectionChange(
  connection: Connection,
  previous: ConnectionStatus,
  state: ConnectionStatus,
): Promise<void> {
  return safely("conexao", null, async () => {
    if (!claudiaFor(connection.companyId) || previous === state) return;
    const key = `claudia:conexao-fora:${connection.id}`;
    if (previous === "connected") {
      if ((await getRedis().set(key, "1", "NX")) === "OK") await enqueueClaudia(connectionPayload("fora"));
    } else if (state === "connected" && (await getRedis().del(key)) === 1) {
      await enqueueClaudia(connectionPayload("voltou"));
    }
  });
}
