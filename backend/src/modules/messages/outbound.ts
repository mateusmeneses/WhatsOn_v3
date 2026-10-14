import { Job } from "bullmq";
import { Op, UniqueConstraintError } from "sequelize";
import { env } from "../../config/env";
import { Connection, Contact, Message, Ticket } from "../../models";
import { getQueue, QueueNames, shardFor } from "../../queues";
import { readMediaBase64 } from "../media/media.storage";
import { emitMessage, emitMessageDeleted } from "../tickets/ticket.events";
import { OutboundMediaType } from "../whatsapp/provider";
import { getProvider } from "../whatsapp/registry";
import { logger } from "../../shared/logger";

export interface OutboundJob {
  messageId: number;
}

export async function enqueueOutbound(messageId: number, ticketId: number): Promise<void> {
  const shard = shardFor(String(ticketId), env.OUTBOUND_SHARDS);
  await getQueue(QueueNames.outbound(shard)).add("send", { messageId });
}

async function markSent(message: Message, providerMessageId: string): Promise<void> {
  try {
    await Message.update({ providerMessageId, ack: "sent" }, { where: { id: message.id } });
  } catch (err) {
    if (!(err instanceof UniqueConstraintError)) throw err;
    // O eco (fromMe) chegou pelo webhook antes de gravarmos o id: ficamos com a nossa mensagem.
    const echoes = await Message.findAll({
      where: { connectionId: message.connectionId, providerMessageId, id: { [Op.ne]: message.id } },
    });
    await Message.destroy({ where: { id: echoes.map((e) => e.id) } });
    echoes.forEach(emitMessageDeleted);
    await Message.update({ providerMessageId, ack: "sent" }, { where: { id: message.id } });
  }
  await message.reload();
  emitMessage(message, "message:update");
}

export async function processOutboundJob(job: Job<OutboundJob>): Promise<void> {
  const message = await Message.findByPk(job.data.messageId, {
    include: [{ model: Ticket, include: [Contact, Connection] }],
  });
  if (!message || message.providerMessageId || message.ack !== "pending") return;
  const { contact, connection } = message.ticket!;

  let providerMessageId: string;
  try {
    const provider = getProvider();
    let result;
    if (message.mediaUrl) {
      result = await provider.sendMedia(connection!.instanceName, contact!.number, {
        type: message.type as OutboundMediaType,
        base64: await readMediaBase64(message.companyId, message.mediaUrl),
        mimetype: message.mediaMime ?? "application/octet-stream",
        fileName: message.mediaName ?? undefined,
        caption: message.body || undefined,
      });
    } else {
      const quoted = message.quotedMessageId ? await Message.findByPk(message.quotedMessageId) : null;
      result = await provider.sendText(
        connection!.instanceName,
        contact!.number,
        message.body,
        quoted?.providerMessageId ?? undefined,
      );
    }
    providerMessageId = result.providerMessageId;
  } catch (err) {
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (finalAttempt) {
      await Message.update({ ack: "failed" }, { where: { id: message.id, ack: "pending" } });
      await message.reload();
      emitMessage(message, "message:update");
    }
    throw err;
  }

  // Já enviado: nunca lançar daqui, pois um retry reenviaria ao cliente.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await markSent(message, providerMessageId);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  logger.error({ err: lastErr, messageId: message.id, providerMessageId }, "failed to persist sent message");
}
