import { Op } from "sequelize";
import { Ticket, TicketStatus } from "../../models";
import { AuthContext } from "../auth/auth.types";

export type TicketFilter = Record<string | symbol, unknown>;

export function canView(auth: AuthContext, queueIds: number[], ticket: Ticket): boolean {
  if (ticket.companyId !== auth.companyId) return false;
  if (auth.profile !== "agent") return true;
  if (ticket.userId === auth.userId) return true;
  return (
    ticket.status === "pending" && ticket.userId === null && ticket.queueId !== null && queueIds.includes(ticket.queueId)
  );
}

/** Filtro adicional para a listagem por status; `null` = o perfil não vê nada nesse status. */
export function visibilityWhere(auth: AuthContext, queueIds: number[], status: TicketStatus): TicketFilter | null {
  if (auth.profile !== "agent") return {};
  if (status === "bot") return null;
  if (status === "pending") {
    return { [Op.or]: [{ userId: auth.userId }, { userId: null, queueId: { [Op.in]: queueIds } }] };
  }
  return { userId: auth.userId };
}
