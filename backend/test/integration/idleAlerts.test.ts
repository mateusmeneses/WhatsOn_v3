import { Ticket, TicketLog } from "../../src/models";
import { emitter, rooms } from "../../src/modules/realtime/socket";
import { sendIdleAlerts } from "../../src/modules/tickets/idleAlerts";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { resetDb } from "../helpers/db";
import { createContact, createMessage, createTicket, createUser, scenario } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";
import { resetRedis } from "../helpers/redis";

const fake = new FakeProvider();
const minutesAgo = (m: number, from = Date.now()) => new Date(from - m * 60_000);

async function setup() {
  const s = await scenario();
  await s.company.update({ idleAlertMinutes: 15 });
  const agent = await createUser(s.company.id, { queueIds: [s.queue.id], phone: "5511911110000" });
  const supervisor = await createUser(s.company.id, { profile: "supervisor", phone: "5511922220000" });
  const admin = await createUser(s.company.id, { profile: "admin", phone: "5511933330000" });
  return { ...s, agent, supervisor, admin };
}

/** Atendimento do técnico com o cliente esperando resposta há `minutes` minutos. */
async function waitingTicket(s: Awaited<ReturnType<typeof setup>>, minutes: number) {
  const ticket = await createTicket({
    companyId: s.company.id,
    contactId: s.contact.id,
    connectionId: s.connection.id,
    queueId: s.queue.id,
    status: "open",
    userId: s.agent.id,
    lastMessageAt: minutesAgo(minutes),
  });
  await createMessage(ticket, { fromMe: true, body: "como posso ajudar?", createdAt: minutesAgo(minutes + 5) });
  await createMessage(ticket, { fromMe: false, body: "preciso de ajuda", createdAt: minutesAgo(minutes) });
  return ticket;
}

describe("idle alerts", () => {
  let emits: { targets: string[]; event: string; payload: unknown }[];

  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    fake.reset();
    setProvider(fake);
    emits = [];
    jest.spyOn(emitter, "toRooms").mockImplementation((targets, event, payload) => {
      if (event === "ticket:idle-alert") emits.push({ targets, event, payload });
    });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => setProvider(null));

  it("escalates once per stage: popup at 15, WhatsApp at 30/45, supervisors at 60", async () => {
    const s = await setup();
    const ticket = await waitingTicket(s, 0);
    const base = Date.now();
    const at = (m: number) => new Date(base + m * 60_000);

    expect(await sendIdleAlerts(at(10))).toBe(0);

    expect(await sendIdleAlerts(at(16))).toBe(1);
    expect(emits).toEqual([
      { targets: [rooms.user(s.agent.id)], event: "ticket:idle-alert", payload: expect.objectContaining({ ticketId: ticket.id, level: 1 }) },
    ]);
    expect(fake.sent).toHaveLength(0);
    expect(await sendIdleAlerts(at(20))).toBe(0); // mesmo estágio não repete

    await sendIdleAlerts(at(31));
    expect(fake.sent.map((m) => m.number)).toEqual(["5511911110000"]);
    expect(fake.sent[0].text).toContain(`/atendimento/${ticket.id}`);

    await sendIdleAlerts(at(46));
    expect(fake.texts()[1]).toContain("URGENTE");

    emits = [];
    await sendIdleAlerts(at(61));
    expect(emits.map((e) => e.targets)).toEqual([[rooms.user(s.agent.id)], [rooms.supervisors(s.company.id)]]);
    expect(emits[1].payload).toMatchObject({ level: 4, escalated: true, agentName: s.agent.name });
    expect(fake.sent.slice(3).map((m) => m.number).sort()).toEqual(["5511922220000", "5511933330000"]);

    expect(await sendIdleAlerts(at(200))).toBe(0); // último estágio é final
    expect((await Ticket.findByPk(ticket.id))!.idleAlertLevel).toBe(4);
  });

  it("jumps straight to the reached stage and restarts after the agent replies", async () => {
    const s = await setup();
    const ticket = await waitingTicket(s, 35);
    await sendIdleAlerts();
    expect(emits.map((e) => (e.payload as { level: number }).level)).toEqual([2]);
    expect(fake.sent).toHaveLength(1);

    await createMessage(ticket, { fromMe: true, body: "já vejo", createdAt: minutesAgo(3) });
    await createMessage(ticket, { fromMe: false, body: "ok", createdAt: minutesAgo(2) });
    emits = [];
    expect(await sendIdleAlerts()).toBe(0);
    await sendIdleAlerts(new Date(Date.now() + 15 * 60_000));
    expect(emits.map((e) => (e.payload as { level: number }).level)).toEqual([1]);
  });

  it("counts from the transfer for the agent who received the ticket", async () => {
    const s = await setup();
    const ticket = await waitingTicket(s, 40);
    await TicketLog.create({ companyId: s.company.id, ticketId: ticket.id, event: "transferred", createdAt: minutesAgo(5) });
    expect(await sendIdleAlerts()).toBe(0);
  });

  it("only counts business minutes of the ticket queue", async () => {
    const s = await setup();
    await s.queue.update({ schedule: { "1": ["08:00-18:00"] } }); // só segunda, 8h às 18h
    // 2026-10-12 é segunda; São Paulo = UTC-3. Cliente escreveu domingo 20:00.
    const sp = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2026, 9, day, hour + 3, minute));
    const ticket = await createTicket({
      companyId: s.company.id,
      contactId: s.contact.id,
      connectionId: s.connection.id,
      queueId: s.queue.id,
      status: "open",
      userId: s.agent.id,
      lastMessageAt: sp(11, 20),
    });
    await createMessage(ticket, { fromMe: false, body: "oi", createdAt: sp(11, 20) });
    expect(await sendIdleAlerts(sp(12, 8, 10))).toBe(0);
    expect(await sendIdleAlerts(sp(12, 8, 16))).toBe(1);
    expect(emits[0].payload).toMatchObject({ level: 1, minutes: 16 });
  });

  it("ignores pending tickets, tickets waiting on the client, and companies with alerts off", async () => {
    const s = await setup();
    const answered = await waitingTicket(s, 90);
    await createMessage(answered, { fromMe: true, body: "resolvido?", createdAt: minutesAgo(1) });
    const pending = await waitingTicket({ ...s, contact: await createContact(s.company.id) }, 90);
    await pending.update({ status: "pending", userId: null });
    expect(await sendIdleAlerts()).toBe(0);

    const off = await setup();
    await off.company.update({ idleAlertMinutes: 0 });
    await waitingTicket(off, 90);
    expect(await sendIdleAlerts()).toBe(0);
    expect(emits).toHaveLength(0);
  });
});
