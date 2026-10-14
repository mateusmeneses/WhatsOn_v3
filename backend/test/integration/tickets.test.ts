import request from "supertest";
import { createApp } from "../../src/app";
import { Message, Ticket, TicketLog } from "../../src/models";
import { closeTicketInternal, moveToPending } from "../../src/modules/tickets/tickets.service";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createContact, createQueue, createTicket, createUser, scenario } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";
import { resetRedis } from "../helpers/redis";

const app = createApp();
const fake = new FakeProvider();

async function world() {
  const s = await scenario();
  const queueB = await createQueue(s.company.id);
  const agentA = await createUser(s.company.id, { queueIds: [s.queue.id] });
  const agentA2 = await createUser(s.company.id, { queueIds: [s.queue.id] });
  const agentB = await createUser(s.company.id, { queueIds: [queueB.id] });
  const supervisor = await createUser(s.company.id, { profile: "supervisor" });
  const ticketFor = async (attrs: Record<string, unknown>) => {
    const contact = await createContact(s.company.id);
    return createTicket({ companyId: s.company.id, contactId: contact.id, connectionId: s.connection.id, ...attrs });
  };
  return { ...s, queueA: s.queue, queueB, agentA, agentA2, agentB, supervisor, ticketFor };
}

const ids = (res: request.Response) => res.body.items.map((t: { id: number }) => t.id).sort();

describe("tickets", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    fake.reset();
    setProvider(fake);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => setProvider(null));

  it("shows agents only pending tickets of their queues or assigned to them", async () => {
    const w = await world();
    const inA = await w.ticketFor({ status: "pending", queueId: w.queueA.id });
    const inB = await w.ticketFor({ status: "pending", queueId: w.queueB.id });
    const assigned = await w.ticketFor({ status: "pending", queueId: w.queueB.id, userId: w.agentA.id });

    const res = await request(app).get("/api/tickets?status=pending").set("Authorization", bearer(w.agentA));
    expect(ids(res)).toEqual([inA.id, assigned.id].sort());
    expect(ids(res)).not.toContain(inB.id);
  });

  it("shows agents only their own open tickets and no bot tickets", async () => {
    const w = await world();
    const mine = await w.ticketFor({ status: "open", queueId: w.queueA.id, userId: w.agentA.id });
    await w.ticketFor({ status: "open", queueId: w.queueA.id, userId: w.agentA2.id });
    await w.ticketFor({ status: "bot" });

    expect(ids(await request(app).get("/api/tickets?status=open").set("Authorization", bearer(w.agentA)))).toEqual([mine.id]);
    expect((await request(app).get("/api/tickets?status=bot").set("Authorization", bearer(w.agentA))).body.items).toEqual([]);
    expect((await request(app).get("/api/tickets?status=bot").set("Authorization", bearer(w.supervisor))).body.items).toHaveLength(1);
  });

  it("lets exactly one of two concurrent agents accept a ticket", async () => {
    const w = await world();
    const ticket = await w.ticketFor({ status: "pending", queueId: w.queueA.id });
    const [r1, r2] = await Promise.all([
      request(app).post(`/api/tickets/${ticket.id}/accept`).set("Authorization", bearer(w.agentA)),
      request(app).post(`/api/tickets/${ticket.id}/accept`).set("Authorization", bearer(w.agentA2)),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.body.error.code).toBe("TICKET_ALREADY_ACCEPTED");
    expect(await TicketLog.count({ where: { ticketId: ticket.id, event: "accepted" } })).toBe(1);
  });

  it("answers 409 to a sequential second accept by another agent of the queue", async () => {
    const w = await world();
    const ticket = await w.ticketFor({ status: "pending", queueId: w.queueA.id });
    const first = await request(app).post(`/api/tickets/${ticket.id}/accept`).set("Authorization", bearer(w.agentA));
    expect(first.status).toBe(200);
    const second = await request(app).post(`/api/tickets/${ticket.id}/accept`).set("Authorization", bearer(w.agentA2));
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("TICKET_ALREADY_ACCEPTED");
  });

  it("answers 409 TICKET_NOT_PENDING when a supervisor accepts a bot or closed ticket", async () => {
    const w = await world();
    for (const status of ["bot", "closed"]) {
      const ticket = await w.ticketFor({ status });
      const res = await request(app).post(`/api/tickets/${ticket.id}/accept`).set("Authorization", bearer(w.supervisor));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("TICKET_NOT_PENDING");
    }
  });

  it("forbids accepting a ticket from another queue", async () => {
    const w = await world();
    const ticket = await w.ticketFor({ status: "pending", queueId: w.queueB.id });
    const res = await request(app).post(`/api/tickets/${ticket.id}/accept`).set("Authorization", bearer(w.agentA));
    expect(res.status).toBe(403);
  });

  it("transfers a ticket to another queue and logs it", async () => {
    const w = await world();
    const ticket = await w.ticketFor({ status: "open", queueId: w.queueA.id, userId: w.agentA.id });
    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/transfer`)
      .set("Authorization", bearer(w.agentA))
      .send({ queueId: w.queueB.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "pending", queueId: w.queueB.id, userId: null });
    const log = await TicketLog.findOne({ where: { ticketId: ticket.id, event: "transferred" } });
    expect(log).toMatchObject({ fromQueueId: w.queueA.id, toQueueId: w.queueB.id, userId: w.agentA.id });
  });

  it("does not let an agent transfer someone else's ticket", async () => {
    const w = await world();
    const ticket = await w.ticketFor({ status: "open", queueId: w.queueA.id, userId: w.agentA2.id });
    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/transfer`)
      .set("Authorization", bearer(w.agentA))
      .send({ queueId: w.queueB.id });
    expect(res.status).toBe(403);
  });

  it("closes a ticket sending the closing message", async () => {
    const w = await world();
    await w.connection.update({ closingMessage: "Obrigado pelo contato!" });
    const ticket = await w.ticketFor({ status: "open", queueId: w.queueA.id, userId: w.agentA.id });
    const res = await request(app).post(`/api/tickets/${ticket.id}/close`).set("Authorization", bearer(w.agentA));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("closed");
    expect(res.body.closedAt).toBeTruthy();
    const sent = await Message.findOne({ where: { ticketId: ticket.id, fromMe: true } });
    expect(sent).toMatchObject({ body: "Obrigado pelo contato!", isBot: true, ack: "pending" });
  });

  it("hides tickets from other companies", async () => {
    const w = await world();
    const other = await scenario();
    const foreign = await createTicket({ companyId: other.company.id, contactId: other.contact.id, connectionId: other.connection.id });
    const res = await request(app).get(`/api/tickets/${foreign.id}`).set("Authorization", bearer(w.supervisor));
    expect(res.status).toBe(404);
  });

  it("resets the unread counter", async () => {
    const w = await world();
    const ticket = await w.ticketFor({ status: "open", userId: w.agentA.id, unreadCount: 4 });
    const res = await request(app).post(`/api/tickets/${ticket.id}/read`).set("Authorization", bearer(w.agentA));
    expect(res.body.unreadCount).toBe(0);
  });

  it("shows pending tickets without a queue to every agent and lets them accept", async () => {
    const w = await world();
    const orphan = await w.ticketFor({ status: "pending", queueId: null });
    const noQueues = await createUser(w.company.id);

    for (const agent of [w.agentA, w.agentB, noQueues]) {
      const list = await request(app).get("/api/tickets?status=pending").set("Authorization", bearer(agent));
      expect(ids(list)).toContain(orphan.id);
      expect((await request(app).get(`/api/tickets/${orphan.id}`).set("Authorization", bearer(agent))).status).toBe(200);
    }
    const res = await request(app).post(`/api/tickets/${orphan.id}/accept`).set("Authorization", bearer(w.agentB));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "open", userId: w.agentB.id });
    // Depois de aceito, some para os outros agentes.
    const after = await request(app).get("/api/tickets?status=pending").set("Authorization", bearer(w.agentA));
    expect(ids(after)).not.toContain(orphan.id);
  });

  it("closes a ticket only once under concurrent close requests", async () => {
    const w = await world();
    await w.connection.update({ closingMessage: "Até logo!" });
    const ticket = await w.ticketFor({ status: "open", queueId: w.queueA.id, userId: w.agentA.id });
    const close = () => request(app).post(`/api/tickets/${ticket.id}/close`).set("Authorization", bearer(w.supervisor));
    const results = await Promise.all([close(), close()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe("TICKET_CLOSED");
    expect(await Message.count({ where: { ticketId: ticket.id, body: "Até logo!" } })).toBe(1);
    expect(await TicketLog.count({ where: { ticketId: ticket.id, event: "closed" } })).toBe(1);
  });

  it("does nothing when closing with a stale instance of an already closed ticket", async () => {
    const w = await world();
    await w.connection.update({ closingMessage: "Até logo!" });
    const ticket = await w.ticketFor({ status: "open", userId: w.agentA.id });
    const stale = (await Ticket.findByPk(ticket.id))!;
    await Ticket.update({ status: "closed" }, { where: { id: ticket.id } });
    const closed = await closeTicketInternal(stale, { userId: null, event: "closed", sendClosingMessage: true });
    expect(closed).toBe(false);
    expect(await Message.count({ where: { ticketId: ticket.id } })).toBe(0);
    expect(await TicketLog.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it("answers 409 when the ticket is closed between the check and the transfer", async () => {
    const w = await world();
    const ticket = await w.ticketFor({ status: "open", queueId: w.queueA.id, userId: w.agentA.id });
    const stale = (await Ticket.findByPk(ticket.id))!;
    await Ticket.update({ status: "closed" }, { where: { id: ticket.id } });
    jest.spyOn(Ticket, "findOne").mockResolvedValueOnce(stale);
    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/transfer`)
      .set("Authorization", bearer(w.supervisor))
      .send({ queueId: w.queueB.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TICKET_CLOSED");
    expect(await Ticket.findByPk(ticket.id)).toMatchObject({ status: "closed", queueId: w.queueA.id });
    expect(await TicketLog.count({ where: { ticketId: ticket.id, event: "transferred" } })).toBe(0);
  });

  it("moveToPending is a no-op when the ticket already left the bot", async () => {
    const w = await world();
    const ticket = await w.ticketFor({ status: "bot" });
    const stale = (await Ticket.findByPk(ticket.id))!;
    await Ticket.update({ status: "open", userId: w.agentA.id }, { where: { id: ticket.id } });
    expect(await moveToPending(stale, w.queueA.id, null)).toBe(false);
    expect(await Ticket.findByPk(ticket.id)).toMatchObject({ status: "open", userId: w.agentA.id });
    expect(await TicketLog.count({ where: { ticketId: ticket.id } })).toBe(0);
  });
});
