import { Worker } from "bullmq";
import { env } from "./config/env";
import { processBotTimeoutJob } from "./modules/chatbot/botTimeout.worker";
import { processMaintenanceJob } from "./modules/connections/maintenance";
import { processInboundJob } from "./modules/inbound/inbound";
import { processOutboundJob } from "./modules/messages/outbound";
import { createWorker, getQueue, QueueNames } from "./queues";
import { logger } from "./shared/logger";

export function startWorkers(): Worker[] {
  const workers: Worker[] = [];
  for (let i = 0; i < env.INBOUND_SHARDS; i++) {
    workers.push(createWorker(QueueNames.inbound(i), processInboundJob, { concurrency: 1 }));
  }
  for (let i = 0; i < env.OUTBOUND_SHARDS; i++) {
    workers.push(createWorker(QueueNames.outbound(i), processOutboundJob, { concurrency: 1 }));
  }
  workers.push(createWorker(QueueNames.botTimeout, processBotTimeoutJob, { concurrency: 5 }));
  workers.push(createWorker(QueueNames.maintenance, processMaintenanceJob, { concurrency: 1 }));

  for (const worker of workers) {
    worker.on("failed", (job, err) =>
      logger.warn({ queue: worker.name, jobId: job?.id, attemptsMade: job?.attemptsMade, err: err.message }, "job failed"),
    );
  }
  return workers;
}

export async function scheduleRecurringJobs(): Promise<void> {
  await getQueue(QueueNames.maintenance).upsertJobScheduler(
    "connection-health",
    { every: 60_000 },
    { name: "connection-health", opts: { attempts: 1, removeOnComplete: true, removeOnFail: 100 } },
  );
  await getQueue(QueueNames.maintenance).upsertJobScheduler(
    "scheduled-messages",
    { every: 30_000 },
    { name: "scheduled-messages", opts: { attempts: 1, removeOnComplete: true, removeOnFail: 100 } },
  );
}
