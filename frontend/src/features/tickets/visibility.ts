import type { Profile, Ticket, TicketAccess, TicketStatus } from "@/types/api";

export interface Viewer extends TicketAccess {
  userId: number;
  profile: Profile;
  queueIds: number[];
}

/** Espelha a regra de visibilidade do backend para decidir em qual aba um ticket atualizado aparece. */
export function ticketVisibleIn(ticket: Ticket, status: TicketStatus, viewer: Viewer): boolean {
  if (ticket.status !== status) return false;
  if (viewer.profile !== "agent") return true;
  if (status === "bot") return viewer.canViewBot;
  if (ticket.userId === viewer.userId) return true;
  if (status === "open") return viewer.canViewOthersOpen;
  return (
    status === "pending" &&
    ticket.userId === null &&
    (ticket.queueId === null || viewer.canViewOtherQueues || viewer.queueIds.includes(ticket.queueId))
  );
}

export function matchesSearch(ticket: Ticket, search: string): boolean {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  const contact = ticket.contact;
  return Boolean(contact) && (contact!.name.toLowerCase().includes(term) || contact!.number.includes(term));
}
