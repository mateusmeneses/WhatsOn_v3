import { api } from "@/lib/api";
import type { Message, Page, StoredMedia } from "@/types/api";

export const messageKeys = {
  ticket: (ticketId: number) => ["messages", ticketId] as const,
};

export async function fetchMessages(ticketId: number, before?: number): Promise<Page<Message>> {
  const { data } = await api.get<Page<Message>>(`/tickets/${ticketId}/messages`, {
    params: { limit: 50, ...(before ? { before } : {}) },
  });
  return data;
}

/** `sign` só é respeitado para administradores; os demais perfis sempre assinam. */
export async function sendMessage(
  ticketId: number,
  body: { body?: string; media?: StoredMedia; sign?: boolean },
): Promise<Message> {
  const { data } = await api.post<Message>(`/tickets/${ticketId}/messages`, body);
  return data;
}

export async function resendMessage(id: number): Promise<Message> {
  const { data } = await api.post<Message>(`/messages/${id}/resend`);
  return data;
}

export async function uploadMedia(file: File): Promise<StoredMedia> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<StoredMedia>("/media", form);
  return data;
}

export async function editMessage(id: number, body: string): Promise<Message> {
  const { data } = await api.patch<Message>(`/messages/${id}`, { body });
  return data;
}

export async function deleteMessage(id: number): Promise<Message> {
  const { data } = await api.delete<Message>(`/messages/${id}`);
  return data;
}
