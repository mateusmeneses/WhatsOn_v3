import { api } from "@/lib/api";
import type { Page, Ticket, TicketStatus } from "@/types/api";

export const ticketKeys = {
  lists: ["tickets", "list"] as const,
  list: (status: TicketStatus, search: string) => ["tickets", "list", status, search] as const,
  detail: (id: number) => ["tickets", "detail", id] as const,
  attendants: (id: number) => ["tickets", "attendants", id] as const,
};

export async function fetchTicketAttendants(id: number): Promise<{ id: number; name: string }[]> {
  const { data } = await api.get<{ id: number; name: string }[]>(`/tickets/${id}/attendants`);
  return data;
}

export async function fetchTickets(status: TicketStatus, search: string, page: number): Promise<Page<Ticket>> {
  const { data } = await api.get<Page<Ticket>>("/tickets", { params: { status, page, ...(search ? { search } : {}) } });
  return data;
}

export async function fetchTicket(id: number): Promise<Ticket> {
  const { data } = await api.get<Ticket>(`/tickets/${id}`);
  return data;
}

export async function acceptTicket(id: number): Promise<Ticket> {
  const { data } = await api.post<Ticket>(`/tickets/${id}/accept`);
  return data;
}

export async function transferTicket(id: number, body: { queueId?: number; userId?: number }): Promise<Ticket> {
  const { data } = await api.post<Ticket>(`/tickets/${id}/transfer`, body);
  return data;
}

export async function closeTicket(id: number): Promise<Ticket> {
  const { data } = await api.post<Ticket>(`/tickets/${id}/close`);
  return data;
}

export async function reopenTicket(id: number): Promise<Ticket> {
  const { data } = await api.post<Ticket>(`/tickets/${id}/reopen`);
  return data;
}

export async function markTicketRead(id: number): Promise<Ticket> {
  const { data } = await api.post<Ticket>(`/tickets/${id}/read`);
  return data;
}
