import { Contact, Message, Queue, Ticket, User } from "../../models";
import { emitter, rooms } from "../realtime/socket";

export const TICKET_INCLUDE = [
  { model: Contact },
  { model: Queue },
  { model: User, attributes: ["id", "name"] },
];

export async function emitTicket(
  ticketId: number,
  prev?: { queueId: number | null; userId: number | null },
): Promise<void> {
  const ticket = await Ticket.findByPk(ticketId, { include: TICKET_INCLUDE });
  if (!ticket) return;
  const targets = new Set<string>([rooms.supervisors(ticket.companyId), rooms.ticketWatchers(ticket.companyId)]);
  // Pendente sem fila nem atendente: todo agente da empresa pode vê-lo (visibility.ts).
  if (ticket.status === "pending" && ticket.queueId === null && ticket.userId === null) {
    targets.add(rooms.company(ticket.companyId));
  }
  for (const side of [ticket, prev]) {
    if (!side) continue;
    if (side.queueId) targets.add(rooms.queue(side.queueId));
    if (side.userId) targets.add(rooms.user(side.userId));
  }
  emitter.toRooms([...targets], "ticket:update", ticket.toJSON());
}

export function emitMessage(message: Message, event: "message:new" | "message:update"): void {
  emitter.toRooms([rooms.ticket(message.ticketId)], event, message.toJSON());
}

export function emitMessageDeleted(message: Message): void {
  emitter.toRooms([rooms.ticket(message.ticketId)], "message:delete", { id: message.id, ticketId: message.ticketId });
}

/** Aviso só para o técnico que perdeu o atendimento ao ser requerido (com o recado interno, se houver). */
export async function emitTicketClaimed(ticketId: number, fromUserId: number, byUserId: number, note: string | null): Promise<void> {
  const [ticket, by] = await Promise.all([
    Ticket.findByPk(ticketId, { include: [{ model: Contact, attributes: ["id", "name"] }] }),
    User.findByPk(byUserId, { attributes: ["id", "name"] }),
  ]);
  if (!ticket || !by) return;
  emitter.toRooms([rooms.user(fromUserId)], "ticket:claimed", {
    ticketId,
    contactName: ticket.contact?.name ?? null,
    by: { id: by.id, name: by.name },
    note,
  });
}
