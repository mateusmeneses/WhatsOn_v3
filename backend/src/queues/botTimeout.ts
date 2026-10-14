import { getQueue, QueueNames } from "./index";

export const botTimeoutJobId = (ticketId: number) => `bot-timeout-${ticketId}`;

export async function cancelBotTimeout(ticketId: number): Promise<void> {
  const job = await getQueue(QueueNames.botTimeout).getJob(botTimeoutJobId(ticketId));
  if (job) await job.remove().catch(() => undefined);
}

/** Reagenda o timeout do bot: remove o job anterior (se houver) e cria outro com o atraso cheio. */
export async function scheduleBotTimeout(ticketId: number, minutes: number): Promise<void> {
  await cancelBotTimeout(ticketId);
  await getQueue(QueueNames.botTimeout).add(
    "timeout",
    { ticketId },
    {
      jobId: botTimeoutJobId(ticketId),
      delay: minutes * 60_000,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
