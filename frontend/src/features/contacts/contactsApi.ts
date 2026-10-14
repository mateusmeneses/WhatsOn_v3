import { api } from "@/lib/api";
import type { Contact, Page } from "@/types/api";

export const contactKeys = {
  all: ["contacts"] as const,
  list: (search: string, page: number) => ["contacts", "list", search, page] as const,
};

export async function fetchContacts(search: string, page: number): Promise<Page<Contact>> {
  const { data } = await api.get<Page<Contact>>("/contacts", { params: { page, ...(search ? { search } : {}) } });
  return data;
}

export async function updateContact(id: number, body: { name: string }): Promise<Contact> {
  const { data } = await api.put<Contact>(`/contacts/${id}`, body);
  return data;
}
