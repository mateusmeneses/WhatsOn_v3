import { create } from "zustand";
import type { ChatMessage } from "./messageCache";

interface LocalMessagesState {
  byTicket: Record<number, ChatMessage[]>;
  add: (ticketId: number, message: ChatMessage) => void;
  update: (ticketId: number, tempId: string, patch: Partial<ChatMessage>) => void;
  remove: (ticketId: number, tempId: string) => void;
}

const EMPTY: ChatMessage[] = [];

/** Mensagens otimistas/falhas ficam fora do cache da query para sobreviver a recargas. */
export const useLocalMessages = create<LocalMessagesState>((set) => ({
  byTicket: {},
  add: (ticketId, message) =>
    set((s) => {
      const list = s.byTicket[ticketId] ?? EMPTY;
      const exists = list.some((m) => m.tempId === message.tempId);
      const next = exists ? list.map((m) => (m.tempId === message.tempId ? message : m)) : [...list, message];
      return { byTicket: { ...s.byTicket, [ticketId]: next } };
    }),
  update: (ticketId, tempId, patch) =>
    set((s) => ({
      byTicket: {
        ...s.byTicket,
        [ticketId]: (s.byTicket[ticketId] ?? EMPTY).map((m) => (m.tempId === tempId ? { ...m, ...patch } : m)),
      },
    })),
  remove: (ticketId, tempId) =>
    set((s) => ({
      byTicket: { ...s.byTicket, [ticketId]: (s.byTicket[ticketId] ?? EMPTY).filter((m) => m.tempId !== tempId) },
    })),
}));

export function useTicketLocalMessages(ticketId: number): ChatMessage[] {
  return useLocalMessages((s) => s.byTicket[ticketId] ?? EMPTY);
}
