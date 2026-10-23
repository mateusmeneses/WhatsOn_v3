import { Job } from "bullmq";
import { runClaudiaWatch } from "../claudia/claudia.watch";
import { dispatchDueScheduled } from "../scheduled/scheduled.service";
import { sendIdleAlerts } from "../tickets/idleAlerts";
import { closeInactiveTickets } from "../tickets/inactivity";
import { checkConnectionsHealth } from "./connections.service";

export async function processMaintenanceJob(job: Job): Promise<void> {
  if (job.name === "connection-health") await checkConnectionsHealth();
  if (job.name === "scheduled-messages") await dispatchDueScheduled();
  if (job.name === "inactivity-close") await closeInactiveTickets();
  if (job.name === "idle-alerts") await sendIdleAlerts();
  if (job.name === "claudia-watch") await runClaudiaWatch();
}
