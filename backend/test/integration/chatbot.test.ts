import { Job } from "bullmq";
import request from "supertest";
import { createApp } from "../../src/app";
import { ChatbotNode, Message, Ticket, TicketLog } from "../../src/models";
import { processBotTimeoutJob } from "../../src/modules/chatbot/botTimeout.worker";
import { runBot } from "../../src/modules/chatbot/chatbot.service";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { getQueue, QueueNames } from "../../src/queues";
import { botTimeoutJobId } from "../../src/queues/botTimeout";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createNode, createTicket, createUser, scenario } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";
import { resetRedis } from "../helpers/redis";

const app = createApp();
const fake = new FakeProvider();

async function setup() {
  const s = await scenario();
  const admin = await createUser(s.company.id, { profile: "admin" });
  const base = `/api/connections/${s.connection.id}/chatbot`;
  const post = (body: Record<string, unknown>) =>
    request(app).post(`${base}/nodes`).set("Authorization", bearer(admin)).send(body);
  return { ...s, admin, base, post };
}

describe("chatbot tree API", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    fake.reset();
    setProvider(fake);
  });
  afterAll(() => setProvider(null));

  it("builds a tree and validates options", async () => {
    const { post, queue } = await setup();
    const root = await post({ parentId: null, message: "Olá!" });
    expect(root.status).toBe(201);
    expect(root.body).toMatchObject({ parentId: null, action: "submenu", key: "" });

    expect((await post({ parentId: null, message: "outra" })).body.error.code).toBe("ROOT_EXISTS");

    const missingQueue = await post({ parentId: root.body.id, key: "1", title: "Suporte", action: "transfer_queue" });
    expect(missingQueue.status).toBe(400);
    expect(missingQueue.body.error.code).toBe("QUEUE_REQUIRED");

    const support = await post({ parentId: root.body.id, key: "1", title: "Suporte", action: "transfer_queue", queueId: queue.id });
    expect(support.status).toBe(201);
    expect(support.body.order).toBe(1);

    const duplicate = await post({ parentId: root.body.id, key: "1", title: "Outro", action: "close" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("KEY_IN_USE");

    const reply = await post({ parentId: root.body.id, key: "2", title: "Horário", action: "reply", message: "8h às 18h" });
    const underReply = await post({ parentId: reply.body.id, key: "1", title: "X", action: "close" });
    expect(underReply.status).toBe(400);
    expect(underReply.body.error.code).toBe("INVALID_PARENT");

    const badKey = await post({ parentId: root.body.id, key: "0", title: "X", action: "close" });
    expect(badKey.status).toBe(400);
  });

  it("lists, reorders and deletes options", async () => {
    const { connection, admin, base } = await setup();
    const root = await createNode(connection, { message: "Olá" });
    const a = await createNode(connection, { parentId: root.id, key: "1", title: "A", action: "close", order: 1 });
    const b = await createNode(connection, { parentId: root.id, key: "2", title: "B", action: "close", order: 2 });

    await request(app)
      .put(`/api/chatbot/nodes/${root.id}/children-order`)
      .set("Authorization", bearer(admin))
      .send({ ids: [b.id, a.id] })
      .expect(200);
    const list = await request(app).get(base).set("Authorization", bearer(admin));
    const children = list.body.filter((n: { parentId: number | null }) => n.parentId === root.id);
    expect(children.map((n: { id: number }) => n.id)).toEqual([b.id, a.id]);

    const wrongIds = await request(app)
      .put(`/api/chatbot/nodes/${root.id}/children-order`)
      .set("Authorization", bearer(admin))
      .send({ ids: [a.id] });
    expect(wrongIds.status).toBe(400);

    await request(app).delete(`/api/chatbot/nodes/${root.id}`).set("Authorization", bearer(admin)).expect(204);
    expect(await ChatbotNode.count()).toBe(0);
  });

  it("updates an option and refuses to turn a submenu with children into another type", async () => {
    const { connection, admin } = await setup();
    const root = await createNode(connection, { message: "Olá" });
    const sub = await createNode(connection, { parentId: root.id, key: "1", title: "Sub", action: "submenu" });
    await createNode(connection, { parentId: sub.id, key: "1", title: "Fim", action: "close" });

    const renamed = await request(app)
      .put(`/api/chatbot/nodes/${sub.id}`)
      .set("Authorization", bearer(admin))
      .send({ title: "Financeiro" });
    expect(renamed.body.title).toBe("Financeiro");

    const res = await request(app)
      .put(`/api/chatbot/nodes/${sub.id}`)
      .set("Authorization", bearer(admin))
      .send({ action: "close" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("HAS_CHILDREN");
  });

  it("simulates a conversation without sending anything", async () => {
    const { connection, admin, base, queue } = await setup();
    const root = await createNode(connection, { message: "Olá!" });
    await createNode(connection, { parentId: root.id, key: "1", title: "Suporte", action: "transfer_queue", queueId: queue.id });

    const greet = await request(app)
      .post(`${base}/simulate`)
      .set("Authorization", bearer(admin))
      .send({ state: { nodeId: null, attempts: 0 }, input: "oi" });
    expect(greet.body.effects).toEqual([{ type: "send_text", text: "Olá!\n\n1 - Suporte" }]);

    const choose = await request(app)
      .post(`${base}/simulate`)
      .set("Authorization", bearer(admin))
      .send({ state: greet.body.state, input: "1" });
    expect(choose.body.finished).toBe(true);
    expect(choose.body.effects.at(-1)).toEqual({ type: "transfer", queueId: queue.id, userId: null });
    expect(fake.sent).toHaveLength(0);
  });
});

describe("runBot", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    fake.reset();
    setProvider(fake);
  });
  afterAll(() => setProvider(null));

  async function botTicket() {
    const s = await scenario();
    const root = await createNode(s.connection, { message: "Olá!" });
    await createNode(s.connection, { parentId: root.id, key: "1", title: "Suporte", action: "transfer_queue", queueId: s.queue.id });
    const ticket = await createTicket({ companyId: s.company.id, contactId: s.contact.id, connectionId: s.connection.id, status: "bot" });
    return { ...s, root, ticket };
  }

  it("greets, stores the bot state and schedules the timeout", async () => {
    const { ticket, root } = await botTicket();
    await runBot(ticket, "oi");
    await ticket.reload();
    expect(ticket.chatbotNodeId).toBe(root.id);
    const sent = await Message.findAll({ where: { ticketId: ticket.id } });
    expect(sent.map((m) => [m.body, m.isBot, m.ack])).toEqual([["Olá!\n\n1 - Suporte", true, "pending"]]);
    const job = await getQueue(QueueNames.botTimeout).getJob(botTimeoutJobId(ticket.id));
    expect(job).toBeDefined();
  });

  it("transfers to the chosen queue and cancels the timeout", async () => {
    const { ticket, queue } = await botTicket();
    await runBot(ticket, "oi");
    await runBot(ticket, "1");
    await ticket.reload();
    expect(ticket).toMatchObject({ status: "pending", queueId: queue.id, chatbotNodeId: null });
    expect(await getQueue(QueueNames.botTimeout).getJob(botTimeoutJobId(ticket.id))).toBeUndefined();
  });

  it("stores the chosen path so the agent sees it", async () => {
    const s = await scenario();
    const root = await createNode(s.connection, { message: "Olá!" });
    const support = await createNode(s.connection, { parentId: root.id, key: "1", title: "Suporte técnico", action: "submenu", message: "Qual sistema?" });
    await createNode(s.connection, { parentId: support.id, key: "1", title: "Sistema X", action: "transfer_queue", queueId: s.queue.id });
    const ticket = await createTicket({ companyId: s.company.id, contactId: s.contact.id, connectionId: s.connection.id, status: "bot" });
    await runBot(ticket, "oi");
    await runBot(ticket, "1");
    await ticket.reload();
    expect(ticket.botPath).toBe("Suporte técnico");
    await runBot(ticket, "1");
    await ticket.reload();
    expect(ticket).toMatchObject({ status: "pending", botPath: "Suporte técnico › Sistema X" });
  });

  it("asks whether it is about the contact's product and goes straight to it on Sim", async () => {
    const s = await scenario();
    await s.contact.update({ product: "Gestão Café" });
    const root = await createNode(s.connection, { message: "Olá!" });
    const support = await createNode(s.connection, { parentId: root.id, key: "1", title: "Suporte técnico", action: "submenu", message: "Qual sistema?" });
    await createNode(s.connection, { parentId: support.id, key: "1", title: "Sistema Fiscal", action: "transfer_queue", queueId: s.queue.id });
    const cafe = await createNode(s.connection, { parentId: support.id, key: "2", title: "Gestão Café", action: "transfer_queue", queueId: s.queue.id });
    const ticket = await createTicket({ companyId: s.company.id, contactId: s.contact.id, connectionId: s.connection.id, status: "bot" });

    await runBot(ticket, "oi");
    await runBot(ticket, "1");
    await ticket.reload();
    expect(ticket.chatbotConfirmNodeId).toBe(cafe.id);
    const asked = await Message.findOne({ where: { ticketId: ticket.id }, order: [["id", "DESC"]] });
    expect(asked?.body).toBe("Seu atendimento é sobre o *Gestão Café*?\n\n1 - Sim\n2 - Não, outro sistema");

    await runBot(ticket, "1");
    await ticket.reload();
    expect(ticket).toMatchObject({ status: "pending", queueId: s.queue.id, botPath: "Suporte técnico › Gestão Café" });
  });

  it("closes tickets still in the bot when the timeout fires", async () => {
    const { ticket } = await botTicket();
    await processBotTimeoutJob({ data: { ticketId: ticket.id } } as Job<{ ticketId: number }>);
    await ticket.reload();
    expect(ticket.status).toBe("closed");
    expect(await TicketLog.count({ where: { ticketId: ticket.id, event: "bot_timeout" } })).toBe(1);
  });

  it("ignores the timeout when the ticket already left the bot", async () => {
    const { ticket } = await botTicket();
    await ticket.update({ status: "pending" });
    await processBotTimeoutJob({ data: { ticketId: ticket.id } } as Job<{ ticketId: number }>);
    expect((await Ticket.findByPk(ticket.id))!.status).toBe("pending");
  });
});
