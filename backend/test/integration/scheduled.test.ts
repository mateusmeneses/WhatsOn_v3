import request from "supertest";
import { createApp } from "../../src/app";
import { Message, ScheduledMessage, Ticket } from "../../src/models";
import { dispatchDueScheduled } from "../../src/modules/scheduled/scheduled.service";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createTicket, createUser, scenario } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";
import { resetRedis } from "../helpers/redis";

const app = createApp();
const fake = new FakeProvider();
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

async function setup(status: "open" | "closed" = "open") {
  const s = await scenario();
  const agent = await createUser(s.company.id, { queueIds: [s.queue.id] });
  const ticket = await createTicket({
    companyId: s.company.id,
    contactId: s.contact.id,
    connectionId: s.connection.id,
    queueId: s.queue.id,
    status,
    userId: agent.id,
    ...(status === "closed" ? { closedAt: new Date() } : {}),
  });
  return { ...s, agent, ticket };
}

function schedule(ticket: Ticket, userId: number, body: string, sendAt: Date) {
  return ScheduledMessage.create({ companyId: ticket.companyId, ticketId: ticket.id, userId, body, sendAt });
}

describe("scheduled messages", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    fake.reset();
    setProvider(fake);
  });
  afterAll(() => setProvider(null));

  it("schedules, lists and cancels a message", async () => {
    const { agent, ticket } = await setup();
    const created = await request(app)
      .post(`/api/tickets/${ticket.id}/scheduled`)
      .set("Authorization", bearer(agent))
      .send({ body: "Lembrete da consulta", sendAt: inMinutes(60) });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ body: "Lembrete da consulta", status: "pending", userId: agent.id });

    const list = await request(app).get(`/api/tickets/${ticket.id}/scheduled`).set("Authorization", bearer(agent));
    expect(list.body.map((s: { id: number }) => s.id)).toEqual([created.body.id]);

    const canceled = await request(app).delete(`/api/scheduled/${created.body.id}`).set("Authorization", bearer(agent));
    expect(canceled.body.status).toBe("canceled");
    const after = await request(app).get(`/api/tickets/${ticket.id}/scheduled`).set("Authorization", bearer(agent));
    expect(after.body).toEqual([]);
  });

  it("rejects a date in the past", async () => {
    const { agent, ticket } = await setup();
    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/scheduled`)
      .set("Authorization", bearer(agent))
      .send({ body: "x", sendAt: inMinutes(-1) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SEND_AT");
  });

  it("forbids scheduling on another agent's ticket", async () => {
    const { ticket, company, queue } = await setup();
    const other = await createUser(company.id, { queueIds: [queue.id] });
    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/scheduled`)
      .set("Authorization", bearer(other))
      .send({ body: "x", sendAt: inMinutes(5) });
    expect(res.status).toBe(403);
  });

  it("sends due messages once and leaves future ones", async () => {
    const { agent, ticket } = await setup();
    const due = await schedule(ticket, agent.id, "Agora", new Date(Date.now() - 1000));
    await schedule(ticket, agent.id, "Depois", new Date(Date.now() + 3_600_000));

    expect(await dispatchDueScheduled()).toBe(1);
    expect(await dispatchDueScheduled()).toBe(0);
    await due.reload();
    expect(due.status).toBe("sent");
    const message = await Message.findByPk(due.messageId!);
    expect(message).toMatchObject({ body: "Agora", fromMe: true, sentByUserId: agent.id, ticketId: ticket.id });
  });

  it("reopens a closed ticket with the scheduling agent before sending", async () => {
    const { agent, ticket } = await setup("closed");
    await schedule(ticket, agent.id, "Retorno", new Date(Date.now() - 1000));
    await dispatchDueScheduled();
    await ticket.reload();
    expect(ticket.status).toBe("open");
    expect(ticket.userId).toBe(agent.id);
    expect(await Message.count({ where: { ticketId: ticket.id, body: "Retorno" } })).toBe(1);
  });

  it("sends on the contact's active ticket when the closed one cannot be reopened", async () => {
    const { agent, ticket, company, contact, connection } = await setup("closed");
    const active = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, status: "pending" });
    const row = await schedule(ticket, agent.id, "Oi", new Date(Date.now() - 1000));
    await dispatchDueScheduled();
    await row.reload();
    expect(row.status).toBe("sent");
    expect((await Message.findByPk(row.messageId!))!.ticketId).toBe(active.id);
    expect((await Ticket.findByPk(ticket.id))!.status).toBe("closed");
  });
});
