import { Company, Message, Ticket, TicketLog } from "../../src/models";
import { closeInactiveTickets } from "../../src/modules/tickets/inactivity";
import { closeTicketInternal } from "../../src/modules/tickets/tickets.service";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { resetDb } from "../helpers/db";
import { createContact, createMessage, createTicket, createUser, scenario } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";
import { resetRedis } from "../helpers/redis";

const fake = new FakeProvider();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

async function setup(company: Partial<Pick<Company, "inactivityCloseMinutes" | "inactivityCloseMessage" | "status">> = {}) {
  const s = await scenario();
  await s.company.update({ inactivityCloseMinutes: 30, inactivityCloseMessage: "Encerramos por falta de resposta.", ...company });
  await s.connection.update({ closingMessage: "Obrigado pelo contato!" });
  const agent = await createUser(s.company.id, { queueIds: [s.queue.id] });
  return { ...s, agent };
}

/** Atendimento em andamento cuja última mensagem tem `minutes` minutos e foi enviada por nós (ou pelo cliente). */
async function idleTicket(s: Awaited<ReturnType<typeof setup>>, minutes: number, lastFromMe = true, status: "open" | "pending" = "open") {
  const at = minutesAgo(minutes);
  const ticket = await createTicket({
    companyId: s.company.id,
    contactId: s.contact.id,
    connectionId: s.connection.id,
    queueId: s.queue.id,
    status,
    userId: status === "open" ? s.agent.id : null,
    lastMessageAt: at,
  });
  await createMessage(ticket, { fromMe: !lastFromMe, body: "primeira", createdAt: minutesAgo(minutes + 5) });
  await createMessage(ticket, { fromMe: lastFromMe, body: "última", createdAt: at });
  return ticket;
}

describe("inactivity close", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    fake.reset();
    setProvider(fake);
  });
  afterAll(() => setProvider(null));

  it("closes an open ticket idle past the limit and sends the inactivity message", async () => {
    const s = await setup();
    const ticket = await idleTicket(s, 31);
    expect(await closeInactiveTickets()).toBe(1);
    await ticket.reload();
    expect(ticket.status).toBe("closed");
    const sent = await Message.findOne({ where: { ticketId: ticket.id }, order: [["id", "DESC"]] });
    expect(sent).toMatchObject({ body: "Encerramos por falta de resposta.", fromMe: true, isBot: true });
    expect(await TicketLog.count({ where: { ticketId: ticket.id, event: "inactivity" } })).toBe(1);
    expect(await closeInactiveTickets()).toBe(0);
  });

  it("falls back to the connection closing message when the company message is empty", async () => {
    const s = await setup({ inactivityCloseMessage: "" });
    const ticket = await idleTicket(s, 45);
    await closeInactiveTickets();
    const sent = await Message.findOne({ where: { ticketId: ticket.id }, order: [["id", "DESC"]] });
    expect(sent!.body).toBe("Obrigado pelo contato!");
  });

  it("leaves tickets within the limit, waiting on us, pending, or with the feature off", async () => {
    const s = await setup();
    const recent = await idleTicket(s, 10);
    const otherContact = () => createContact(s.company.id);
    const waitingOnUs = await idleTicket({ ...s, contact: await otherContact() }, 60, false);
    const pending = await idleTicket({ ...s, contact: await otherContact() }, 60, true, "pending");
    expect(await closeInactiveTickets()).toBe(0);
    for (const t of [recent, waitingOnUs, pending]) expect((await Ticket.findByPk(t.id))!.status).not.toBe("closed");

    const off = await setup({ inactivityCloseMinutes: 0 });
    await idleTicket(off, 600);
    const blocked = await setup({ status: "blocked" });
    await idleTicket(blocked, 600);
    expect(await closeInactiveTickets()).toBe(0);
  });

  it("does not close when a message arrived after the idle cutoff", async () => {
    const s = await setup();
    const ticket = await idleTicket(s, 31);
    await Ticket.update({ lastMessageAt: new Date() }, { where: { id: ticket.id } });
    const closed = await closeTicketInternal(ticket, {
      userId: null,
      event: "inactivity",
      sendClosingMessage: true,
      idleSince: minutesAgo(30),
    });
    expect(closed).toBe(false);
    expect((await Ticket.findByPk(ticket.id))!.status).toBe("open");
  });
});
