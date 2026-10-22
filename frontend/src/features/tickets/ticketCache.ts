import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { Page, Ticket, TicketStatus } from "@/types/api";
import { ticketKeys } from "./ticketsApi";
import { matchesSearch, ticketVisibleIn, type Viewer } from "./visibility";

export type TicketPages = InfiniteData<Page<Ticket>, number>;

const lastActivity = (t: Ticket) => (t.lastMessageAt ? Date.parse(t.lastMessageAt) : 0);

export function upsertTicket(data: TicketPages, ticket: Ticket, belongs: boolean): TicketPages {
  const pages = data.pages.map((page) => ({ ...page, items: page.items.filter((t) => t.id !== ticket.id) }));
  if (belongs && pages.length > 0) {
    const first = pages[0]!;
    const items = [...first.items, ticket].sort((a, b) => lastActivity(b) - lastActivity(a) || b.id - a.id);
    pages[0] = { ...first, items };
  }
  return { ...data, pages };
}

export function applyTicketUpdate(queryClient: QueryClient, ticket: Ticket, viewer: Viewer): void {
  for (const [key, data] of queryClient.getQueriesData<TicketPages>({ queryKey: ticketKeys.lists })) {
    if (!data) continue;
    const [, , status, search, mine] = key as unknown as [string, string, TicketStatus, string, boolean?];
    const belongs =
      ticketVisibleIn(ticket, status, viewer) && matchesSearch(ticket, search) && (!mine || ticket.userId === viewer.userId);
    queryClient.setQueryData<TicketPages>(key, upsertTicket(data, ticket, belongs));
  }
  queryClient.setQueryData(ticketKeys.detail(ticket.id), ticket);
}
