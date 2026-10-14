import { Processor, Queue, Worker, WorkerOptions } from "bullmq";
import IORedis from "ioredis";
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
    queues.set(name, queue);
  }
  return queue;
}

export function createWorker<T>(name: string, processor: Processor<T>, opts: Partial<WorkerOptions> = {}): Worker<T> {
  const connection = createRedis();
  workerConnections.push(connection);
  return new Worker<T>(name, processor, { ...opts, connection });
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
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  await Promise.all(workerConnections.map((c) => c.quit().catch(() => undefined)));
  workerConnections.length = 0;
}
