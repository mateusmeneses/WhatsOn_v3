import { literal, Op } from "sequelize";
import { Company, Ticket } from "../../models";
import { logger } from "../../shared/logger";
import { restartedAt } from "./restart";
import { closeTicketInternal } from "./tickets.service";

const BATCH = 100;

/**
 * Última mensagem humana (mensagens automáticas do bot/sistema não contam) foi nossa: quem está devendo resposta é o
 * cliente. Ex.: cliente escreveu e o bot respondeu "fora do horário" → o suporte ainda deve a resposta.
 */
export const lastHumanMessageFromUs = literal(
  `(SELECT m."fromMe" FROM messages m WHERE m."ticketId" = "Ticket"."id" AND m."isBot" = false ` +
    `ORDER BY m."createdAt" DESC, m."id" DESC LIMIT 1) = true`,
);

/** Hora da última mensagem humana (lembretes automáticos não recomeçam a contagem). */
export const lastHumanMessageAt = literal(
  `(SELECT MAX(m."createdAt") FROM messages m WHERE m."ticketId" = "Ticket"."id" AND m."isBot" = false)`,
);

/**
 * Finaliza, com a mensagem de inatividade, os atendimentos em andamento cujo cliente não responde há mais que o
 * tempo configurado na empresa. Só conta quando a última mensagem humana foi do atendente: cliente esperando
 * resposta nunca é encerrado.
 */
export async function closeInactiveTickets(now = new Date()): Promise<number> {
  const companies = await Company.findAll({
    where: { inactivityCloseMinutes: { [Op.gt]: 0 }, status: { [Op.ne]: "blocked" } },
    attributes: ["id", "inactivityCloseMinutes", "inactivityCloseMessage"],
  });
  let closed = 0;
  for (const company of companies) {
    const idleSince = new Date(now.getTime() - company.inactivityCloseMinutes * 60_000);
    const tickets = await Ticket.findAll({
      where: {
        companyId: company.id,
        status: "open",
        [Op.and]: [
          lastHumanMessageFromUs,
          literal(`${lastHumanMessageAt.val} <= ${Ticket.sequelize!.escape(idleSince)}`),
          // Só conta depois do aceite: cliente que esperou 30 min na fila não é finalizado ao ser aceito.
          literal(`COALESCE(${restartedAt.val} <= ${Ticket.sequelize!.escape(idleSince)}, true)`),
        ],
      },
      order: [["lastMessageAt", "ASC"]],
      limit: BATCH,
    });
    for (const ticket of tickets) {
      try {
        const done = await closeTicketInternal(ticket, {
          userId: null,
          event: "inactivity",
          sendClosingMessage: true,
          closingMessage: company.inactivityCloseMessage,
          idleSince,
        });
        if (done) closed += 1;
      } catch (err) {
        logger.error({ err, ticketId: ticket.id }, "failed to close inactive ticket");
      }
    }
  }
  return closed;
}
