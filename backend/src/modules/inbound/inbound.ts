import { Job } from "bullmq";
import { env } from "../../config/env";
import { Connection } from "../../models";
import { getQueue, QueueNames, shardFor } from "../../queues";
import { applyConnectionUpdate, applyQrCode } from "../connections/connections.service";
import { applyAck } from "../messages/messages.service";
import { InboundEvent } from "../whatsapp/provider";
import { handleInboundMessage } from "./handleMessage";

export interface InboundJob {
  connectionId: number;
  event: InboundEvent;
}

/** Eventos do mesmo contato (mensagens e acks) caem no mesmo shard e são processados em ordem. */
export function routingKey(connectionId: number, event: InboundEvent): string {
  if (event.kind === "message") return `${connectionId}:${event.remoteNumber}`;
  if (event.kind === "ack" && event.remoteNumber) return `${connectionId}:${event.remoteNumber}`;
  return `${connectionId}:_`;
}

export async function enqueueInbound(connectionId: number, event: InboundEvent): Promise<void> {
  const shard = shardFor(routingKey(connectionId, event), env.INBOUND_SHARDS);
  await getQueue(QueueNames.inbound(shard)).add(event.kind, { connectionId, event });
}

export async function handleInboundEvent(job: InboundJob, opts: { finalAttempt: boolean }): Promise<void> {
  const connection = await Connection.findByPk(job.connectionId);
  if (!connection) return;
  const { event } = job;
  switch (event.kind) {
    case "message":
      return handleInboundMessage(connection, event, opts);
    case "ack":
      return applyAck(connection.id, event.providerMessageId, event.ack);
    case "connection":
      return applyConnectionUpdate(connection, event.state, event.number);
    case "qrcode":
      return applyQrCode(connection, event.qrBase64);
  }
}

export async function processInboundJob(job: Job<InboundJob>): Promise<void> {
  await handleInboundEvent(job.data, { finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1) });
}
