import { Job } from "bullmq";
import request from "supertest";
import { createApp } from "../../src/app";
import { env } from "../../src/config/env";
import { Message, ScheduledMessage } from "../../src/models";
import { createOutgoingMessage } from "../../src/modules/messages/messages.service";
import { OutboundJob, processOutboundJob } from "../../src/modules/messages/outbound";
import { dispatchDueScheduled } from "../../src/modules/scheduled/scheduled.service";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { createWorker, getQueue, QueueNames } from "../../src/queues";
import { resetDb } from "../helpers/db";
import { createCompany, createConnection, createTicket, createUser, scenario } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";
import { resetRedis } from "../helpers/redis";
import { waitFor } from "../helpers/waitFor";

/**
 * Regressão: a cobrança das 11 h (API externa) saía toda de uma vez e a sessão da Evolution travava.
 * Envios em lote da mesma conexão precisam sair espaçados, sem atrasar as respostas de atendimento.
 */
const app = createApp();
const fake = new FakeProvider();
const TOKEN = "b".repeat(64);
const auth = `Bearer ${TOKEN}`;

/** Horário previsto de cada job (criação + atraso), por mensagem. */
async function plannedAt(messageIds: number[]): Promise<Map<number, number>> {
  const jobs: Job<OutboundJob>[] = [];
  for (let i = 0; i < env.OUTBOUND_SHARDS; i++) {
    jobs.push(...(await getQueue(QueueNames.outbound(i)).getJobs(["waiting", "delayed"])));
  }
  const byMessage = new Map<number, number>();
  for (const j of jobs) {
    if (messageIds.includes(j.data.messageId)) byMessage.set(j.data.messageId, j.timestamp + (j.opts.delay ?? 0));
  }
  return byMessage;
}

async function delayOf(messageId: number): Promise<number> {
  for (let i = 0; i < env.OUTBOUND_SHARDS; i++) {
    const found = (await getQueue(QueueNames.outbound(i)).getJobs(["waiting", "delayed"])).find(
      (j) => j.data.messageId === messageId,
    );
    if (found) return found.opts.delay ?? 0;
  }
  throw new Error(`job da mensagem ${messageId} não encontrado`);
}

function gaps(times: number[]): number[] {
  return times.slice(1).map((t, i) => t - times[i]);
}

async function sendViaApi(number: string, body: string): Promise<number> {
  const res = await request(app).post("/api/v1/messages/send").set("Authorization", auth).send({ number, body });
  expect(res.status).toBe(201);
  return res.body.messages[0].id as number;
}

describe("outbound batch throttle", () => {
  const original = { min: env.OUTBOUND_BATCH_MIN_MS, max: env.OUTBOUND_BATCH_MAX_MS };

  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    fake.reset();
    setProvider(fake);
    env.OUTBOUND_BATCH_MIN_MS = 4000;
    env.OUTBOUND_BATCH_MAX_MS = 8000;
  });
  afterEach(() => {
    env.OUTBOUND_BATCH_MIN_MS = original.min;
    env.OUTBOUND_BATCH_MAX_MS = original.max;
  });
  afterAll(() => setProvider(null));

  it("spaces messages sent through the external API on the same connection", async () => {
    const company = await createCompany();
    await createConnection(company.id, { apiToken: TOKEN });
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) ids.push(await sendViaApi(`55119888800${i}0`, `Cobrança ${i}`));

    const planned = await plannedAt(ids);
    const times = ids.map((id) => planned.get(id)!);
    expect(await delayOf(ids[0])).toBe(0);
    for (const gap of gaps(times)) {
      expect(gap).toBeGreaterThanOrEqual(4000 - 100);
      expect(gap).toBeLessThanOrEqual(8000 + 100);
    }
  });

  it("does not delay agent replies nor batches of another connection", async () => {
    const s = await scenario();
    await s.connection.update({ apiToken: TOKEN });
    const ticket = await createTicket({ companyId: s.company.id, contactId: s.contact.id, connectionId: s.connection.id, status: "open" });
    await sendViaApi("5511988880010", "Cobrança 1");
    const second = await sendViaApi("5511988880020", "Cobrança 2");
    expect(await delayOf(second)).toBeGreaterThan(0);

    const agent = await createUser(s.company.id);
    const reply = await createOutgoingMessage(ticket, { body: "Bom dia!", sentByUserId: agent.id });
    expect(await delayOf(reply.id)).toBe(0);

    const other = await createConnection(s.company.id);
    const otherTicket = await createTicket({ companyId: s.company.id, contactId: s.contact.id, connectionId: other.id, status: "closed" });
    const otherBatch = await createOutgoingMessage(otherTicket, { body: "Cobrança", batch: true });
    expect(await delayOf(otherBatch.id)).toBe(0);
  });

  it("spaces due scheduled messages of the same connection", async () => {
    const s = await scenario();
    const agent = await createUser(s.company.id, { queueIds: [s.queue.id] });
    const ticket = await createTicket({ companyId: s.company.id, contactId: s.contact.id, connectionId: s.connection.id, status: "open", userId: agent.id, queueId: s.queue.id });
    for (let i = 0; i < 3; i++) {
      await ScheduledMessage.create({ companyId: s.company.id, ticketId: ticket.id, userId: agent.id, body: `Lembrete ${i}`, sendAt: new Date(Date.now() - 1000) });
    }
    expect(await dispatchDueScheduled()).toBe(3);
    const ids = (await Message.findAll({ where: { ticketId: ticket.id }, order: [["id", "ASC"]] })).map((m) => m.id);
    const planned = await plannedAt(ids);
    for (const gap of gaps(ids.map((id) => planned.get(id)!))) expect(gap).toBeGreaterThanOrEqual(4000 - 100);
  });

  it("delivers a batch one at a time, never in parallel, with the configured interval", async () => {
    env.OUTBOUND_BATCH_MIN_MS = 300;
    env.OUTBOUND_BATCH_MAX_MS = 400;
    const company = await createCompany();
    await createConnection(company.id, { apiToken: TOKEN });

    let inFlight = 0;
    let maxInFlight = 0;
    const sentAt: number[] = [];
    const realSend = fake.sendText.bind(fake);
    jest.spyOn(fake, "sendText").mockImplementation(async (...args) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      sentAt.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight--;
      return realSend(...args);
    });

    const workers = Array.from({ length: env.OUTBOUND_SHARDS }, (_, i) =>
      createWorker(QueueNames.outbound(i), processOutboundJob, { concurrency: 1 }),
    );
    try {
      for (let i = 0; i < 4; i++) await sendViaApi(`55119777700${i}0`, `Cobrança ${i}`);
      await waitFor(async () => fake.sent.length, (n) => n === 4, 10_000);
      expect(maxInFlight).toBe(1);
      for (const gap of gaps(sentAt)) expect(gap).toBeGreaterThanOrEqual(300 - 50);
    } finally {
      await Promise.all(workers.map((w) => w.close()));
    }
  });
});
