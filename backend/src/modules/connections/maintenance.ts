import { Job } from "bullmq";
import { dispatchDueScheduled } from "../scheduled/scheduled.service";
import { closeInactiveTickets } from "../tickets/inactivity";
import { checkConnectionsHealth } from "./connections.service";

export async function processMaintenanceJob(job: Job): Promise<void> {
  if (job.name === "connection-health") await checkConnectionsHealth();
  if (job.name === "scheduled-messages") await dispatchDueScheduled();
  if (job.name === "inactivity-close") await closeInactiveTickets();
}
