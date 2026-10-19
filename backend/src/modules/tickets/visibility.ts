import { Op } from "sequelize";
import { Ticket, TicketStatus, User } from "../../models";
import { AuthContext } from "../auth/auth.types";
import { userQueueIds } from "../users/userQueues";

export type TicketFilter = Record<string | symbol, unknown>;

/** O que um atendente alcança: suas filas e as permissões extras dadas pelo admin. */
export interface AgentScope {
  queueIds: number[];
  canViewBot: boolean;
  canViewOtherQueues: boolean;
  canViewOthersOpen: boolean;
}

export const NO_SCOPE: AgentScope = { queueIds: [], canViewBot: false, canViewOtherQueues: false, canViewOthersOpen: false };

/** Fila acessível ao agente: uma das suas filas ou nenhuma fila (sem fila padrão o cliente não pode sumir). */
export function agentQueueEligible(scope: AgentScope, queueId: number | null): boolean {
  return queueId === null || scope.canViewOtherQueues || scope.queueIds.includes(queueId);
}

export function canView(auth: AuthContext, scope: AgentScope, ticket: Ticket): boolean {
  if (ticket.companyId !== auth.companyId) return false;
  if (auth.profile !== "agent") return true;
  if (ticket.userId === auth.userId) return true;
  if (ticket.status === "bot") return scope.canViewBot;
  if (ticket.status === "open") return scope.canViewOthersOpen;
  return ticket.status === "pending" && ticket.userId === null && agentQueueEligible(scope, ticket.queueId);
}

/** Filtro adicional para a listagem por status; `null` = o perfil não vê nada nesse status. */
export function visibilityWhere(auth: AuthContext, scope: AgentScope, status: TicketStatus): TicketFilter | null {
  if (auth.profile !== "agent") return {};
  if (status === "bot") return scope.canViewBot ? {} : null;
  if (status === "open" && scope.canViewOthersOpen) return {};
  if (status === "pending") {
    const unassigned = scope.canViewOtherQueues
      ? { userId: null }
      : { userId: null, [Op.or]: [{ queueId: { [Op.in]: scope.queueIds } }, { queueId: null }] };
    return { [Op.or]: [{ userId: auth.userId }, unassigned] };
  }
  return { userId: auth.userId };
}

/** Escopo do atendente logado; outros perfis veem tudo e não precisam dele. */
export async function loadAgentScope(auth: AuthContext): Promise<AgentScope> {
  if (auth.profile !== "agent") return NO_SCOPE;
  const [user, queueIds] = await Promise.all([
    User.findByPk(auth.userId, { attributes: ["canViewBot", "canViewOtherQueues", "canViewOthersOpen", "canClaimTickets"] }),
    userQueueIds(auth.userId),
  ]);
  // Quem pode requerer precisa enxergar todos os atendimentos para achar o que quer requerer.
  const all = user?.canClaimTickets ?? false;
  return {
    queueIds,
    canViewBot: all || (user?.canViewBot ?? false),
    canViewOtherQueues: all || (user?.canViewOtherQueues ?? false),
    canViewOthersOpen: all || (user?.canViewOthersOpen ?? false),
  };
}

/** Atendente com alguma permissão extra precisa receber os eventos de todos os chamados da empresa. */
export function watchesAllTickets(scope: AgentScope): boolean {
  return scope.canViewBot || scope.canViewOtherQueues || scope.canViewOthersOpen;
}
