import { Processor, Queue, Worker, WorkerOptions } from "bullmq";
import IORedis from "ioredis";
import { logger } from "../shared/logger";
import { createRedis, getRedis } from "../shared/redis";

export const QueueNames = {
  inbound: (shard: number) => `inbound-${shard}`,
  outbound: (shard: number) => `outbound-${shard}`,
  botTimeout: "bot-timeout",
  maintenance: "maintenance",
} as const;

/** Hash estável → shard. Mesmo key sempre cai no mesmo shard. */
export function shardFor(key: string, shards: number): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0;
  return hash % shards;
}

const queues = new Map<string, Queue>();
const workerConnections: IORedis[] = [];
const workers = new Set<Worker>();

export function getQueue(name: string): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: false,
      },
    });
    queue.on("error", (err) => logger.error({ queue: name, err }, "queue error"));
    queues.set(name, queue);
  }
  return queue;
}

export function createWorker<T>(name: string, processor: Processor<T>, opts: Partial<WorkerOptions> = {}): Worker<T> {
  const connection = createRedis();
  connection.on("error", (err) => logger.error({ queue: name, err }, "worker connection error"));
  workerConnections.push(connection);
  const worker = new Worker<T>(name, processor, { ...opts, connection });
  worker.on("error", (err) => logger.error({ queue: name, err }, "worker error"));
  workers.add(worker as Worker);
  worker.on("closed", () => workers.delete(worker as Worker));
  return worker;
}

export function allQueueNames(inboundShards: number, outboundShards: number): string[] {
  return [
    ...Array.from({ length: inboundShards }, (_, i) => QueueNames.inbound(i)),
    ...Array.from({ length: outboundShards }, (_, i) => QueueNames.outbound(i)),
    QueueNames.botTimeout,
    QueueNames.maintenance,
  ];
}

export async function closeQueues(): Promise<void> {
  // Workers primeiro: eles são donos das conexões; só depois as conexões são encerradas.
  await Promise.all(
    [...workers].map(async (w) => {
      await w.waitUntilReady().catch(() => undefined);
      await w.close().catch(() => undefined);
    }),
  );
  workers.clear();
  // Fechar uma Queue antes da conexão terminar de inicializar remove os listeners e deixa o erro de init sem tratamento.
  await Promise.all(
    [...queues.values()].map(async (q) => {
      await q.waitUntilReady().catch(() => undefined);
      await q.close().catch(() => undefined);
    }),
  );
  queues.clear();
  await Promise.all(
    workerConnections.map(async (c) => {
      try {
        if (c.status === "end") return;
        await c.quit();
      } catch {
        c.disconnect();
      }
    }),
  );
  workerConnections.length = 0;
}
