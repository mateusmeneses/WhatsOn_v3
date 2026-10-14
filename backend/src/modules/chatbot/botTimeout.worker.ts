import { Job } from "bullmq";
import { Ticket } from "../../models";
import { closeTicketInternal } from "../tickets/tickets.service";

export async function processBotTimeoutJob(job: Job<{ ticketId: number }>): Promise<void> {
  const ticket = await Ticket.findByPk(job.data.ticketId);
  if (!ticket || ticket.status !== "bot") return;
  await closeTicketInternal(ticket, { userId: null, event: "bot_timeout", sendClosingMessage: false });
}
