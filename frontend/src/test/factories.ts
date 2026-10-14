import type { Contact, Message, Ticket } from "@/types/api";

export function makeMessage(partial: Partial<Message> = {}): Message {
  return {
    id: 100,
    companyId: 1,
    ticketId: 1,
    connectionId: 1,
    providerMessageId: "P100",
    fromMe: false,
    body: "Oi",
    type: "text",
    mediaUrl: null,
    mediaMime: null,
    mediaName: null,
    ack: "delivered",
    quotedMessageId: null,
    sentByUserId: null,
    isBot: false,
    createdAt: "2026-10-14T10:00:00.000Z",
    updatedAt: "2026-10-14T10:00:00.000Z",
    ...partial,
  };
}

export function makeContact(partial: Partial<Contact> = {}): Contact {
  return { id: 1, companyId: 1, name: "Maria Souza", number: "5511988887777", profilePicUrl: null, isGroup: false, ...partial };
}

export function makeTicket(partial: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    companyId: 1,
    contactId: 1,
    connectionId: 1,
    queueId: 10,
    userId: null,
    status: "pending",
    chatbotNodeId: null,
    chatbotAttempts: 0,
    lastMessage: "Oi",
    lastMessageAt: "2026-10-14T10:00:00.000Z",
    unreadCount: 0,
    closedAt: null,
    createdAt: "2026-10-14T09:00:00.000Z",
    updatedAt: "2026-10-14T10:00:00.000Z",
    contact: makeContact(),
    queue: { id: 10, companyId: 1, name: "Suporte", color: "#6d5dfc", schedule: {} },
    user: null,
    ...partial,
  };
}
