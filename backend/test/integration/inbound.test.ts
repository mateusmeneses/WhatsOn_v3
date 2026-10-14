import request from "supertest";
import { createApp } from "../../src/app";
import { env } from "../../src/config/env";
import { Connection, Contact, Message, Ticket } from "../../src/models";
import * as chatbot from "../../src/modules/chatbot/chatbot.service";
import { handleInboundEvent, processInboundJob, routingKey } from "../../src/modules/inbound/inbound";
import { clearWebhookCache } from "../../src/modules/inbound/webhook.routes";
import { createOutgoingMessage } from "../../src/modules/messages/messages.service";
import { parseEvolutionWebhook } from "../../src/modules/whatsapp/evolution/parseWebhook";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { createWorker, getQueue, QueueNames, shardFor } from "../../src/queues";
import { resetDb } from "../helpers/db";
import { createNode, createTicket, scenario } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";
import { resetRedis } from "../helpers/redis";
import { waitFor } from "../helpers/waitFor";
import { ackUpdate, connectionUpdate, imageMessage, textMessage, upsert } from "../fixtures/evolution";

const app = createApp();
const fake = new FakeProvider();

async function deliver(connection: Connection, payload: Record<string, unknown>, finalAttempt = false) {
  for (const event of parseEvolutionWebhook(payload)) {
    await handleInboundEvent({ connectionId: connection.id, event }, { finalAttempt });
  }
}

async function withBot(connection: Connection, queueId: number) {
  const root = await createNode(connection, { message: "Olá! Escolha:" });
  await createNode(connection, { parentId: root.id, key: "1", title: "Atendimento", action: "transfer_queue", queueId });
  return root;
}

const ticketMessages = (ticketId: number) => Message.findAll({ where: { ticketId }, order: [["id", "ASC"]] });

describe("inbound pipeline", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    clearWebhookCache();
    fake.reset();
    setProvider(fake);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => setProvider(null));

  it("creates contact and bot ticket, stores the message and greets", async () => {
    const { connection, queue } = await scenario();
    const root = await withBot(connection, queue.id);
    await deliver(connection, textMessage({ from: "5511955554444", pushName: "Maria", text: "Oi" }));

    const contact = await Contact.findOne({ where: { number: "5511955554444" } });
    expect(contact!.name).toBe("Maria");
    const ticket = await Ticket.findOne({ where: { contactId: contact!.id } });
    expect(ticket).toMatchObject({ status: "bot", chatbotNodeId: root.id, unreadCount: 1 });
    const messages = await ticketMessages(ticket!.id);
    expect(messages.map((m) => [m.body, m.fromMe, m.isBot])).toEqual([
      ["Oi", false, false],
      ["Olá! Escolha:\n\n1 - Atendimento", true, true],
    ]);
  });

  it("routes the customer's choice to the queue", async () => {
    const { connection, queue } = await scenario();
    await withBot(connection, queue.id);
    await deliver(connection, textMessage({ id: "A1", text: "Oi" }));
    await deliver(connection, textMessage({ id: "A2", text: "1" }));
    const ticket = await Ticket.findOne();
    expect(ticket).toMatchObject({ status: "pending", queueId: queue.id });
  });

  it("ignores duplicate webhooks", async () => {
    const { connection } = await scenario();
    await deliver(connection, textMessage({ id: "DUP" }));
    await deliver(connection, textMessage({ id: "DUP" }));
    expect(await Message.count({ where: { providerMessageId: "DUP" } })).toBe(1);
  });

  it("puts the ticket in the default queue when the connection has no bot", async () => {
    const { connection, queue } = await scenario();
    await deliver(connection, textMessage());
    expect(await Ticket.findOne()).toMatchObject({ status: "pending", queueId: queue.id });
    expect(await Message.count({ where: { isBot: true } })).toBe(0);
  });

  it("opens a new ticket (through the bot again) after the previous one was closed", async () => {
    const { company, connection, queue, contact } = await scenario();
    await withBot(connection, queue.id);
    const old = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, status: "closed" });
    await deliver(connection, textMessage({ from: contact.number }));
    const tickets = await Ticket.findAll({ where: { contactId: contact.id }, order: [["id", "ASC"]] });
    expect(tickets.map((t) => [t.id === old.id, t.status])).toEqual([
      [true, "closed"],
      [false, "bot"],
    ]);
  });

  it("does not run the bot again on a pending ticket", async () => {
    const { company, connection, queue, contact } = await scenario();
    await withBot(connection, queue.id);
    const ticket = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, status: "pending", queueId: queue.id });
    await deliver(connection, textMessage({ from: contact.number, text: "alguém aí?" }));
    const messages = await ticketMessages(ticket.id);
    expect(messages.map((m) => m.body)).toEqual(["alguém aí?"]);
  });

  it("takes the ticket out of the bot when the company replies from the phone", async () => {
    const { company, connection, queue, contact } = await scenario();
    await withBot(connection, queue.id);
    const ticket = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, status: "bot" });
    await deliver(connection, textMessage({ from: contact.number, fromMe: true, text: "já te atendo" }));
    await ticket.reload();
    expect(ticket).toMatchObject({ status: "open", userId: null, chatbotNodeId: null });
    expect(await Message.count({ where: { isBot: true } })).toBe(0);
  });

  it("reconciles the echo of a message we sent instead of duplicating it", async () => {
    const { company, connection, contact } = await scenario();
    const ticket = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, status: "open" });
    const sent = await createOutgoingMessage(ticket, { body: "Olá, tudo bem?" });
    await deliver(connection, textMessage({ id: "ECHO1", from: contact.number, fromMe: true, text: "Olá, tudo bem?" }));
    const messages = await ticketMessages(ticket.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: sent.id, providerMessageId: "ECHO1", ack: "sent" });
  });

  it("ignores group messages", async () => {
    const { connection } = await scenario();
    await deliver(connection, upsert({ key: { remoteJid: "120363000000@g.us", fromMe: false, id: "G1" }, message: { conversation: "oi" } }));
    expect(await Ticket.count()).toBe(0);
  });

  it("downloads and stores media", async () => {
    const { company, connection } = await scenario();
    await deliver(connection, imageMessage({ caption: "comprovante" }));
    const message = await Message.findOne();
    expect(message).toMatchObject({ type: "image", body: "comprovante", mediaMime: "image/jpeg" });
    expect(message!.mediaUrl).toMatch(new RegExp(`^/media/${company.id}/`));
  });

  it("retries media download, then stores a placeholder on the final attempt", async () => {
    const { connection } = await scenario();
    fake.failNext("downloadMedia");
    await expect(deliver(connection, imageMessage({ caption: "" }))).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(await Message.count()).toBe(0);

    fake.failNext("downloadMedia");
    await deliver(connection, imageMessage({ caption: "" }), true);
    expect(await Message.findOne()).toMatchObject({ type: "image", body: "[mídia indisponível]", mediaUrl: null });
  });

  it("applies ack and connection events", async () => {
    const { company, connection, contact } = await scenario();
    const ticket = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, status: "open" });
    const message = await Message.create({
      companyId: company.id, ticketId: ticket.id, connectionId: connection.id,
      fromMe: true, body: "x", type: "text", ack: "sent", providerMessageId: "OUT1",
    });
    await deliver(connection, ackUpdate("OUT1", "READ", contact.number));
    expect((await message.reload()).ack).toBe("read");

    await deliver(connection, connectionUpdate("close"));
    expect((await connection.reload()).status).toBe("disconnected");
  });

  it("webhook rejects unknown tokens and enqueues events on the contact shard", async () => {
    const { connection } = await scenario();
    await request(app).post("/webhooks/evolution/nao-existe").send(textMessage()).expect(404);

    await request(app).post(`/webhooks/evolution/${connection.webhookToken}`).send(textMessage({ from: "5511944443333" })).expect(200);
    const [event] = parseEvolutionWebhook(textMessage({ from: "5511944443333" }));
    const shard = shardFor(routingKey(connection.id, event), env.INBOUND_SHARDS);
    expect(routingKey(connection.id, event)).toBe(`${connection.id}:5511944443333`);
    const jobs = await getQueue(QueueNames.inbound(shard)).getJobs(["waiting"]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data).toMatchObject({ connectionId: connection.id, event: { kind: "message", remoteNumber: "5511944443333" } });
  });

  it("processes messages of the same contact in order and with a single ticket", async () => {
    const { connection } = await scenario();
    const workers = Array.from({ length: env.INBOUND_SHARDS }, (_, i) =>
      createWorker(QueueNames.inbound(i), processInboundJob, { concurrency: 1 }),
    );
    try {
      const hook = `/webhooks/evolution/${connection.webhookToken}`;
      await request(app).post(hook).send(textMessage({ id: "O1", text: "primeira" })).expect(200);
      await request(app).post(hook).send(textMessage({ id: "O2", text: "segunda" })).expect(200);
      await request(app).post(hook).send(textMessage({ id: "O3", text: "terceira" })).expect(200);
      const messages = await waitFor(
        () => Message.findAll({ order: [["id", "ASC"]] }),
        (rows) => rows.length === 3,
      );
      expect(messages.map((m) => m.body)).toEqual(["primeira", "segunda", "terceira"]);
      expect(await Ticket.count()).toBe(1);
    } finally {
      await Promise.all(workers.map((w) => w.close()));
    }
  });

  it("does not run the bot when the ticket left the bot state while the message was being processed", async () => {
    // Determinístico: o download da mídia (executado durante o processamento) move o ticket para "pending",
    // como faria o worker de timeout ou um atendente.
    const { company, connection, queue, contact } = await scenario();
    await withBot(connection, queue.id);
    const ticket = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, status: "bot" });
    jest.spyOn(fake, "downloadMedia").mockImplementation(async () => {
      await ticket.update({ status: "pending", queueId: queue.id });
      return { base64: Buffer.from("x").toString("base64"), mimetype: "image/jpeg" };
    });
    await deliver(connection, imageMessage({ from: contact.number, caption: "foto" }));
    expect(await Message.count({ where: { ticketId: ticket.id, isBot: true } })).toBe(0);
    expect(await Message.count({ where: { ticketId: ticket.id } })).toBe(1);
  });

  it("keeps the inbound message when the bot throws", async () => {
    const { connection, queue } = await scenario();
    await withBot(connection, queue.id);
    jest.spyOn(chatbot, "runBot").mockRejectedValue(new Error("boom"));
    await expect(deliver(connection, textMessage({ id: "B1", text: "Oi" }))).resolves.toBeUndefined();
    expect(await Message.count({ where: { providerMessageId: "B1" } })).toBe(1);
  });
});
