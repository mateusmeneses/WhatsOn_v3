import { literal, Op } from "sequelize";
import { Company, Ticket } from "../../models";
import { logger } from "../../shared/logger";
import { closeTicketInternal } from "./tickets.service";

const BATCH = 100;

/** Última mensagem do atendimento foi nossa (atendente ou bot): quem está devendo resposta é o cliente. */
const lastMessageFromUs = literal(
  `(SELECT m."fromMe" FROM messages m WHERE m."ticketId" = "Ticket"."id" ORDER BY m."createdAt" DESC, m."id" DESC LIMIT 1) = true`,
);

/**
 * Finaliza, com a mensagem de inatividade, os atendimentos em andamento cujo cliente não responde há mais que o
 * tempo configurado na empresa. Só conta quando a última mensagem foi nossa: cliente esperando resposta nunca é
 * encerrado.
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
        lastMessageAt: { [Op.lte]: idleSince },
        [Op.and]: [lastMessageFromUs],
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
