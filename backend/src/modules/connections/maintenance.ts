import { Job } from "bullmq";
import { checkConnectionsHealth } from "./connections.service";

export async function processMaintenanceJob(job: Job): Promise<void> {
  if (job.name === "connection-health") await checkConnectionsHealth();
}
