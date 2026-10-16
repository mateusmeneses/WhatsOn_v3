import type { InfiniteData } from "@tanstack/react-query";
import type { Message, MessageType, Page, StoredMedia, Ticket } from "@/types/api";

export type ChatMessage = Message & { tempId?: string; localFailed?: boolean };
export type MessagePages = InfiniteData<Page<ChatMessage>, number | undefined>;

/** A página 0 tem as mensagens mais novas; cada página vem em ordem cronológica. */
export function flattenMessages(data?: MessagePages): ChatMessage[] {
  if (!data) return [];
  return [...data.pages].reverse().flatMap((page) => page.items);
}

const sameMessage = (a: ChatMessage, b: ChatMessage) =>
  a.id === b.id || (b.tempId !== undefined && a.tempId === b.tempId);

export function upsertMessage(data: MessagePages, message: ChatMessage): MessagePages {
  let found = false;
  const pages = data.pages.map((page) => ({
    ...page,
    items: page.items.map((item) => {
      if (!sameMessage(item, message)) return item;
      found = true;
      return { ...item, ...message };
    }),
  }));
  if (!found) {
    const first = pages[0] ?? { items: [], hasMore: false };
    pages[0] = { ...first, items: [...first.items, message] };
  }
  return { ...data, pages, pageParams: data.pageParams.length ? data.pageParams : [undefined] };
}

export function removeMessage(data: MessagePages, predicate: (message: ChatMessage) => boolean): MessagePages {
  return { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.filter((m) => !predicate(m)) })) };
}

export function mediaTypeFromMime(mime: string): MessageType {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

let tempSequence = 0;

export function createTempMessage(ticket: Ticket, body: string, media: StoredMedia | null, userId: number): ChatMessage {
  tempSequence += 1;
  const now = new Date().toISOString();
  return {
    id: -tempSequence,
    tempId: `tmp-${Date.now()}-${tempSequence}`,
    companyId: ticket.companyId,
    ticketId: ticket.id,
    connectionId: ticket.connectionId,
    providerMessageId: null,
    fromMe: true,
    body,
    type: media ? mediaTypeFromMime(media.mime) : "text",
    mediaUrl: media?.url ?? null,
    mediaMime: media?.mime ?? null,
    mediaName: media?.name ?? null,
    ack: "pending",
    quotedMessageId: null,
    sentByUserId: userId,
    isBot: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** Mesmos limites do backend (WhatsApp): editar até 15 min, apagar para todos até 2 dias. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const DELETE_WINDOW_MS = 48 * 60 * 60 * 1000;

const age = (m: ChatMessage, now: number) => now - new Date(m.createdAt).getTime();
const isOwnServerMessage = (m: ChatMessage) => m.fromMe && !m.tempId && m.id > 0 && !m.deletedAt;

export function canEditMessage(m: ChatMessage, now = Date.now()): boolean {
  return (
    isOwnServerMessage(m) &&
    m.type === "text" &&
    Boolean(m.providerMessageId) &&
    m.ack !== "pending" &&
    m.ack !== "failed" &&
    age(m, now) <= EDIT_WINDOW_MS
  );
}

export function canDeleteMessage(m: ChatMessage, now = Date.now()): boolean {
  if (!isOwnServerMessage(m) || m.ack === "pending") return false;
  return !m.providerMessageId || age(m, now) <= DELETE_WINDOW_MS;
}
