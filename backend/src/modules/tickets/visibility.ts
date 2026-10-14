import { Op } from "sequelize";
import { Ticket, TicketStatus } from "../../models";
import { AuthContext } from "../auth/auth.types";

export type TicketFilter = Record<string | symbol, unknown>;

/** Fila acessível ao agente: uma das suas filas ou nenhuma fila (sem fila padrão o cliente não pode sumir). */
export function agentQueueEligible(queueIds: number[], queueId: number | null): boolean {
  return queueId === null || queueIds.includes(queueId);
}

export function canView(auth: AuthContext, queueIds: number[], ticket: Ticket): boolean {
  if (ticket.companyId !== auth.companyId) return false;
  if (auth.profile !== "agent") return true;
  if (ticket.userId === auth.userId) return true;
  return ticket.status === "pending" && ticket.userId === null && agentQueueEligible(queueIds, ticket.queueId);
}

/** Filtro adicional para a listagem por status; `null` = o perfil não vê nada nesse status. */
export function visibilityWhere(auth: AuthContext, queueIds: number[], status: TicketStatus): TicketFilter | null {
  if (auth.profile !== "agent") return {};
  if (status === "bot") return null;
  if (status === "pending") {
    return {
      [Op.or]: [
        { userId: auth.userId },
        { userId: null, [Op.or]: [{ queueId: { [Op.in]: queueIds } }, { queueId: null }] },
      ],
    };
  }
  return { userId: auth.userId };
}
