import { api } from "@/lib/api";
import type { Contact, Page, Ticket } from "@/types/api";

export const contactKeys = {
  all: ["contacts"] as const,
  list: (search: string, page: number) => ["contacts", "list", search, page] as const,
};

export async function fetchContacts(search: string, page: number): Promise<Page<Contact>> {
  const { data } = await api.get<Page<Contact>>("/contacts", { params: { page, ...(search ? { search } : {}) } });
  return data;
}

export type ContactUpdate = Partial<Pick<Contact, "name" | "clientCompany" | "managerClientId" | "product" | "managerProductId" | "isRobot">>;

export async function updateContact(id: number, body: ContactUpdate): Promise<Contact> {
  const { data } = await api.put<Contact>(`/contacts/${id}`, body);
  return data;
}

export interface ContactStats {
  id: number;
  tickets: number;
  lastContactAt: string | null;
  activeStatus: "bot" | "pending" | "open" | null;
}

export async function fetchContactStats(ids: number[]): Promise<ContactStats[]> {
  if (ids.length === 0) return [];
  const { data } = await api.get<ContactStats[]>("/contacts/stats", { params: { ids: ids.join(",") } });
  return data;
}

/** Abre (ou reaproveita) o atendimento com o contato. Sem conexão, o backend escolhe ou responde CONNECTION_REQUIRED. */
export async function startConversation(id: number, connectionId?: number): Promise<Ticket> {
  const { data } = await api.post<Ticket>(`/contacts/${id}/conversation`, connectionId ? { connectionId } : {});
  return data;
}
