import request from "supertest";
import { createApp } from "../../src/app";
import { Message, Ticket, TicketLog } from "../../src/models";
import { closeTicketInternal, moveToPending } from "../../src/modules/tickets/tickets.service";
import { emitter, rooms } from "../../src/modules/realtime/socket";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createContact, createMessage, createQueue, createTicket, createUser, scenario } from "../helpers/factories";
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
  const admin = await createUser(s.company.id, { profile: "admin" });
  const ticketFor = async (attrs: Record<string, unknown>) => {
    const contact = await createContact(s.company.id);
    return createTicket({ companyId: s.company.id, contactId: contact.id, connectionId: s.connection.id, ...attrs });
  };
  return { ...s, queueA: s.queue, queueB, agentA, agentA2, agentB, supervisor, admin, ticketFor };
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

  it("answers 409 TICKET_NOT_PENDING when a supervisor accepts an open or closed ticket", async () => {
    const w = await world();
    for (const status of ["open", "closed"]) {
      const ticket = await w.ticketFor({ status });
      const res = await request(app).post(`/api/tickets/${ticket.id}/accept`).set("Authorization", bearer(w.supervisor));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("TICKET_NOT_PENDING");
    }
  });

  it("lets a supervisor take a ticket still in the bot, leaving the chatbot flow", async () => {
    const w = await world();
    const ticket = await w.ticketFor({ status: "bot", queueId: null, chatbotAttempts: 2 });
    const res = await request(app).post(`/api/tickets/${ticket.id}/accept`).set("Authorization", bearer(w.supervisor));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "open", userId: w.supervisor.id, chatbotNodeId: null, chatbotAttempts: 0 });
    expect(await TicketLog.count({ where: { ticketId: ticket.id, event: "accepted" } })).toBe(1);
  });

  describe("extra visibility permissions", () => {
    it("keeps agents without permissions limited to their scope", async () => {
      const w = await world();
      const bot = await w.ticketFor({ status: "bot" });
      const othersOpen = await w.ticketFor({ status: "open", queueId: w.queueA.id, userId: w.agentA2.id });
      const inB = await w.ticketFor({ status: "pending", queueId: w.queueB.id });
      for (const t of [bot, othersOpen, inB]) {
        expect((await request(app).get(`/api/tickets/${t.id}`).set("Authorization", bearer(w.agentA))).status).toBe(403);
      }
      expect((await request(app).post(`/api/tickets/${bot.id}/accept`).set("Authorization", bearer(w.agentA))).status).toBe(403);
    });

    it("canViewBot shows and lets the agent take bot tickets", async () => {
      const w = await world();
      const agent = await createUser(w.company.id, { queueIds: [w.queueA.id], canViewBot: true });
      const bot = await w.ticketFor({ status: "bot" });
      expect(ids(await request(app).get("/api/tickets?status=bot").set("Authorization", bearer(agent)))).toEqual([bot.id]);
      expect((await request(app).get(`/api/tickets/${bot.id}`).set("Authorization", bearer(agent))).status).toBe(200);
      const res = await request(app).post(`/api/tickets/${bot.id}/accept`).set("Authorization", bearer(agent));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "open", userId: agent.id });
    });

    it("canViewOtherQueues shows and lets the agent take pending tickets of any queue", async () => {
      const w = await world();
      const agent = await createUser(w.company.id, { queueIds: [w.queueA.id], canViewOtherQueues: true });
      const inA = await w.ticketFor({ status: "pending", queueId: w.queueA.id });
      const inB = await w.ticketFor({ status: "pending", queueId: w.queueB.id });
      await w.ticketFor({ status: "pending", queueId: w.queueB.id, userId: w.agentB.id });
      await w.ticketFor({ status: "bot" });
      expect(ids(await request(app).get("/api/tickets?status=pending").set("Authorization", bearer(agent)))).toEqual(
        [inA.id, inB.id].sort(),
      );
      expect((await request(app).get("/api/tickets?status=bot").set("Authorization", bearer(agent))).body.items).toEqual([]);
      const res = await request(app).post(`/api/tickets/${inB.id}/accept`).set("Authorization", bearer(agent));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "open", userId: agent.id });
    });

    it("canViewOthersOpen shows other agents' open tickets but does not let the agent handle them", async () => {
      const w = await world();
      const agent = await createUser(w.company.id, { queueIds: [w.queueA.id], canViewOthersOpen: true });
      const mine = await w.ticketFor({ status: "open", queueId: w.queueA.id, userId: agent.id });
      const others = await w.ticketFor({ status: "open", queueId: w.queueB.id, userId: w.agentB.id });
      await w.ticketFor({ status: "closed", userId: w.agentB.id });
      expect(ids(await request(app).get("/api/tickets?status=open").set("Authorization", bearer(agent)))).toEqual(
        [mine.id, others.id].sort(),
      );
      expect((await request(app).get("/api/tickets?status=closed").set("Authorization", bearer(agent))).body.items).toEqual([]);
      expect((await request(app).get(`/api/tickets/${others.id}`).set("Authorization", bearer(agent))).status).toBe(200);
      const close = await request(app).post(`/api/tickets/${others.id}/close`).set("Authorization", bearer(agent));
      expect(close.status).toBe(403);
      await others.update({ unreadCount: 3 });
      const read = await request(app).post(`/api/tickets/${others.id}/read`).set("Authorization", bearer(agent));
      expect(read.body.unreadCount).toBe(3);
    });
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

  it("closes a ticket without the closing message when asked", async () => {
    const w = await world();
    await w.connection.update({ closingMessage: "Obrigado pelo contato!" });
    const ticket = await w.ticketFor({ status: "open", queueId: w.queueA.id, userId: w.agentA.id });
    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/close`)
      .set("Authorization", bearer(w.agentA))
      .send({ sendClosingMessage: false });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("closed");
    expect(await Message.count({ where: { ticketId: ticket.id, fromMe: true } })).toBe(0);
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

  describe("reopen", () => {
    it("reopens a closed ticket with the agent and logs it", async () => {
      const w = await world();
      const ticket = await w.ticketFor({ status: "closed", userId: w.agentA.id, queueId: w.queueA.id, closedAt: new Date() });
      const res = await request(app).post(`/api/tickets/${ticket.id}/reopen`).set("Authorization", bearer(w.agentA));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "open", userId: w.agentA.id, closedAt: null });
      expect(await TicketLog.count({ where: { ticketId: ticket.id, event: "reopened" } })).toBe(1);
    });

    it("lets a supervisor reopen any ticket, assigning it to themself", async () => {
      const w = await world();
      const ticket = await w.ticketFor({ status: "closed", userId: w.agentA.id, closedAt: new Date() });
      const res = await request(app).post(`/api/tickets/${ticket.id}/reopen`).set("Authorization", bearer(w.supervisor));
      expect(res.body).toMatchObject({ status: "open", userId: w.supervisor.id });
    });

    it("refuses another agent's ticket and tickets that are not closed", async () => {
      const w = await world();
      const closed = await w.ticketFor({ status: "closed", userId: w.agentA.id, closedAt: new Date() });
      const other = await request(app).post(`/api/tickets/${closed.id}/reopen`).set("Authorization", bearer(w.agentA2));
      expect(other.status).toBe(403);
      const open = await w.ticketFor({ status: "open", userId: w.agentA.id });
      const res = await request(app).post(`/api/tickets/${open.id}/reopen`).set("Authorization", bearer(w.agentA));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("TICKET_NOT_CLOSED");
    });

    it("refuses when the contact already has an active ticket", async () => {
      const w = await world();
      const closed = await w.ticketFor({ status: "closed", userId: w.agentA.id, closedAt: new Date() });
      await createTicket({ companyId: w.company.id, contactId: closed.contactId, connectionId: closed.connectionId, status: "pending" });
      const res = await request(app).post(`/api/tickets/${closed.id}/reopen`).set("Authorization", bearer(w.agentA));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("TICKET_ACTIVE_EXISTS");
    });
  });

  describe("claim", () => {
    const claim = (id: number, user: Parameters<typeof bearer>[0], body: Record<string, unknown> = {}) =>
      request(app).post(`/api/tickets/${id}/claim`).set("Authorization", bearer(user)).send(body);

    it("takes a ticket from another agent at once and leaves an internal note for them", async () => {
      const w = await world();
      const claimer = await createUser(w.company.id, { canClaimTickets: true });
      const ticket = await w.ticketFor({ status: "open", queueId: w.queueA.id, userId: w.agentA.id });
      const toRooms = jest.spyOn(emitter, "toRooms");

      const res = await claim(ticket.id, claimer, { note: "Cliente é meu, pode deixar" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: ticket.id, status: "open", userId: claimer.id, queueId: w.queueA.id });

      const notice = toRooms.mock.calls.find(([, event]) => event === "ticket:claimed");
      expect(notice).toBeDefined();
      expect(notice![0]).toEqual([rooms.user(w.agentA.id)]);
      expect(notice![2]).toMatchObject({ ticketId: ticket.id, by: { id: claimer.id, name: claimer.name }, note: "Cliente é meu, pode deixar" });
      // O recado é interno: nada vai para o WhatsApp do cliente.
      expect(await Message.count({ where: { ticketId: ticket.id } })).toBe(0);
      expect(fake.sent).toEqual([]);

      const history = await request(app).get(`/api/tickets/${ticket.id}/history`).set("Authorization", bearer(claimer));
      expect(history.body.at(-1)).toMatchObject({
        event: "claimed",
        user: { id: claimer.id },
        fromUser: { id: w.agentA.id, name: w.agentA.name },
        note: "Cliente é meu, pode deixar",
      });
    });

    it("takes a ticket out of the bot and out of the waiting list", async () => {
      const w = await world();
      const bot = await w.ticketFor({ status: "bot", chatbotAttempts: 2 });
      const pending = await w.ticketFor({ status: "pending", queueId: w.queueB.id });
      const res1 = await claim(bot.id, w.admin);
      expect(res1.body).toMatchObject({ status: "open", userId: w.admin.id, chatbotNodeId: null, chatbotAttempts: 0 });
      const res2 = await claim(pending.id, w.admin);
      expect(res2.body).toMatchObject({ status: "open", userId: w.admin.id, queueId: w.queueB.id });
      const log = await TicketLog.findOne({ where: { ticketId: pending.id, event: "claimed" } });
      expect(log).toMatchObject({ userId: w.admin.id, fromUserId: null, note: null });
    });

    it("is allowed to admins always and to others only with the permission", async () => {
      const w = await world();
      const ticket = await w.ticketFor({ status: "open", queueId: w.queueA.id, userId: w.agentA.id });
      expect((await claim(ticket.id, w.supervisor)).status).toBe(403);
      expect((await claim(ticket.id, w.agentA2)).status).toBe(403);
      const supervisor = await createUser(w.company.id, { profile: "supervisor", canClaimTickets: true });
      expect((await claim(ticket.id, supervisor)).status).toBe(200);
    });

    it("refuses closed tickets and tickets already yours", async () => {
      const w = await world();
      const closed = await w.ticketFor({ status: "closed", userId: w.agentA.id, closedAt: new Date() });
      expect((await claim(closed.id, w.admin)).body.error.code).toBe("TICKET_CLOSED");
      const mine = await w.ticketFor({ status: "open", userId: w.admin.id });
      expect((await claim(mine.id, w.admin)).body.error.code).toBe("TICKET_ALREADY_YOURS");
    });

    it("rejects notes longer than 1000 characters", async () => {
      const w = await world();
      const ticket = await w.ticketFor({ status: "open", userId: w.agentA.id });
      expect((await claim(ticket.id, w.admin, { note: "x".repeat(1001) })).status).toBe(400);
    });

    it("lets agents with the permission see every ticket so they can find it", async () => {
      const w = await world();
      const claimer = await createUser(w.company.id, { canClaimTickets: true });
      const bot = await w.ticketFor({ status: "bot" });
      const others = await w.ticketFor({ status: "open", queueId: w.queueB.id, userId: w.agentB.id });
      const otherQueue = await w.ticketFor({ status: "pending", queueId: w.queueB.id });
      const list = (status: string) => request(app).get(`/api/tickets?status=${status}`).set("Authorization", bearer(claimer));
      expect(ids(await list("bot"))).toEqual([bot.id]);
      expect(ids(await list("open"))).toEqual([others.id]);
      expect(ids(await list("pending"))).toEqual([otherQueue.id]);
    });
  });

  describe("history", () => {
    it("returns the ticket timeline with who did what and the transfers", async () => {
      const w = await world();
      const ticket = await w.ticketFor({ status: "pending", queueId: w.queueA.id });
      await request(app).post(`/api/tickets/${ticket.id}/accept`).set("Authorization", bearer(w.agentA));
      await request(app)
        .post(`/api/tickets/${ticket.id}/transfer`)
        .set("Authorization", bearer(w.agentA))
        .send({ queueId: w.queueB.id, userId: w.agentB.id });
      await request(app).post(`/api/tickets/${ticket.id}/accept`).set("Authorization", bearer(w.agentB));
      await request(app)
        .post(`/api/tickets/${ticket.id}/close`)
        .set("Authorization", bearer(w.agentB))
        .send({ sendClosingMessage: false });

      const res = await request(app).get(`/api/tickets/${ticket.id}/history`).set("Authorization", bearer(w.supervisor));
      expect(res.status).toBe(200);
      expect(res.body.map((e: { event: string }) => e.event)).toEqual(["accepted", "transferred", "accepted", "closed"]);
      expect(res.body[1]).toMatchObject({
        user: { id: w.agentA.id, name: w.agentA.name },
        fromQueue: { id: w.queueA.id, name: w.queueA.name },
        toQueue: { id: w.queueB.id, name: w.queueB.name },
        toUser: { id: w.agentB.id, name: w.agentB.name },
      });
      expect(res.body[3]).toMatchObject({ user: { id: w.agentB.id }, toUser: null });
      expect(res.body[0].createdAt).toEqual(expect.any(String));
    });

    it("is hidden from agents without access to the ticket", async () => {
      const w = await world();
      const ticket = await w.ticketFor({ status: "pending", queueId: w.queueB.id });
      const denied = await request(app).get(`/api/tickets/${ticket.id}/history`).set("Authorization", bearer(w.agentA));
      expect(denied.status).toBe(403);
    });
  });

  describe("attendants", () => {
    it("lists who accepted, replied and holds the ticket, in order of arrival", async () => {
      const w = await world();
      const ticket = await w.ticketFor({ status: "pending", queueId: w.queueA.id });
      await request(app).post(`/api/tickets/${ticket.id}/accept`).set("Authorization", bearer(w.agentA));
      await createMessage(ticket, { fromMe: true, sentByUserId: w.supervisor.id });
      await createMessage(ticket, { fromMe: true, sentByUserId: w.agentA.id });
      await request(app)
        .post(`/api/tickets/${ticket.id}/transfer`)
        .set("Authorization", bearer(w.agentA))
        .send({ userId: w.agentA2.id });

      const res = await request(app).get(`/api/tickets/${ticket.id}/attendants`).set("Authorization", bearer(w.supervisor));
      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { id: w.agentA.id, name: w.agentA.name },
        { id: w.supervisor.id, name: w.supervisor.name },
        { id: w.agentA2.id, name: w.agentA2.name },
      ]);
    });

    it("is empty for a ticket nobody handled and hidden from agents without access", async () => {
      const w = await world();
      const ticket = await w.ticketFor({ status: "pending", queueId: w.queueB.id });
      const res = await request(app).get(`/api/tickets/${ticket.id}/attendants`).set("Authorization", bearer(w.supervisor));
      expect(res.body).toEqual([]);
      const denied = await request(app).get(`/api/tickets/${ticket.id}/attendants`).set("Authorization", bearer(w.agentA));
      expect(denied.status).toBe(403);
    });
  });
});

describe("ticket summary", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    setProvider(fake);
  });

  it("counts what is waiting for the user: visible pending, own open and their unread messages", async () => {
    const w = await world();
    await w.ticketFor({ queueId: w.queueA.id, status: "pending", unreadCount: 3 }); // visível ao agentA
    await w.ticketFor({ queueId: w.queueB.id, status: "pending", unreadCount: 5 }); // fila de outro: invisível
    await w.ticketFor({ queueId: w.queueA.id, status: "open", userId: w.agentA.id, unreadCount: 2 });
    await w.ticketFor({ queueId: w.queueA.id, status: "open", userId: w.agentA2.id, unreadCount: 7 }); // de outro atendente

    const agent = await request(app).get("/api/tickets/summary").set("Authorization", bearer(w.agentA)).expect(200);
    expect(agent.body).toEqual({ pending: 1, mine: 1, unread: 5 });

    const supervisor = await request(app).get("/api/tickets/summary").set("Authorization", bearer(w.supervisor)).expect(200);
    expect(supervisor.body).toEqual({ pending: 2, mine: 0, unread: 8 });
  });
});
