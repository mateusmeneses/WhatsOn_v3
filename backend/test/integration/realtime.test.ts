import http from "node:http";
import { AddressInfo } from "node:net";
import { io as ioc, Socket } from "socket.io-client";
import { closeSocket, disconnectCompany, emitter, initSocket, rooms } from "../../src/modules/realtime/socket";
import { emitMessage, emitMessageDeleted, emitTicket } from "../../src/modules/tickets/ticket.events";
import { bearer, superAdminBearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCompany, createMessage, createQueue, createSuperAdmin, createTicket, createUser, scenario } from "../helpers/factories";

let server: http.Server;
let port: number;
const clients: Socket[] = [];

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = ioc(`http://localhost:${port}`, { auth: { token }, transports: ["websocket"], forceNew: true });
    clients.push(socket);
    socket.once("ready", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function nextEvent<T = unknown>(socket: Socket, event: string, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sem evento ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function noEvent(socket: Socket, event: string, waitMs = 300): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = () => reject(new Error(`evento inesperado ${event}`));
    socket.once(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, waitMs);
  });
}

describe("realtime", () => {
  beforeEach(async () => {
    await resetDb();
    server = http.createServer();
    initSocket(server, { canJoinTicket: async (_auth, ticketId) => ticketId !== 999 });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    clients.splice(0).forEach((c) => c.disconnect());
    await closeSocket();
  });

  it("rejects connections without a valid token", async () => {
    await expect(connect("invalido")).rejects.toThrow("UNAUTHENTICATED");
  });

  it("delivers company broadcasts", async () => {
    const { company } = await scenario();
    const agent = await createUser(company.id);
    const socket = await connect(bearer(agent).slice(7));
    const received = nextEvent(socket, "ping:test");
    emitter.toCompany(company.id, "ping:test", { ok: true });
    await expect(received).resolves.toEqual({ ok: true });
  });

  it("routes ticket updates to supervisors and to the ticket's queue only", async () => {
    const { company, connection, contact } = await scenario();
    const queueA = await createQueue(company.id);
    const queueB = await createQueue(company.id);
    const supervisor = await createUser(company.id, { profile: "supervisor" });
    const agentA = await createUser(company.id, { queueIds: [queueA.id] });
    const agentB = await createUser(company.id, { queueIds: [queueB.id] });
    const [sSup, sA, sB] = await Promise.all([supervisor, agentA, agentB].map((u) => connect(bearer(u).slice(7))));

    const ticket = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, queueId: queueA.id });
    const supGot = nextEvent<{ id: number; contact: { id: number } }>(sSup, "ticket:update");
    const aGot = nextEvent(sA, "ticket:update");
    const bSilent = noEvent(sB, "ticket:update");
    await emitTicket(ticket.id);
    const payload = await supGot;
    expect(payload.id).toBe(ticket.id);
    expect(payload.contact.id).toBe(contact.id);
    await aGot;
    await bSilent;

    await ticket.update({ queueId: queueB.id });
    const aOld = nextEvent(sA, "ticket:update");
    const bNew = nextEvent(sB, "ticket:update");
    await emitTicket(ticket.id, { queueId: queueA.id, userId: null });
    await Promise.all([aOld, bNew]);
  });

  it("sends every ticket update to agents with extra visibility permissions", async () => {
    const { company, connection, contact } = await scenario();
    const queueA = await createQueue(company.id);
    const queueB = await createQueue(company.id);
    const watcher = await createUser(company.id, { queueIds: [queueA.id], canViewBot: true });
    const plain = await createUser(company.id, { queueIds: [queueA.id] });
    const [sWatcher, sPlain] = await Promise.all([watcher, plain].map((u) => connect(bearer(u).slice(7))));

    const ticket = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, queueId: queueB.id });
    const got = nextEvent<{ id: number }>(sWatcher, "ticket:update");
    const silent = noEvent(sPlain, "ticket:update");
    await emitTicket(ticket.id);
    expect((await got).id).toBe(ticket.id);
    await silent;
  });

  it("joins ticket rooms only when allowed", async () => {
    const { company } = await scenario();
    const agent = await createUser(company.id);
    const socket = await connect(bearer(agent).slice(7));

    const okAck = await new Promise((resolve) => socket.emit("ticket:join", 5, resolve));
    expect(okAck).toBe(true);
    const got = nextEvent(socket, "message:new");
    emitter.toRooms([rooms.ticket(5)], "message:new", { id: 1 });
    await expect(got).resolves.toEqual({ id: 1 });

    const deniedAck = await new Promise((resolve) => socket.emit("ticket:join", 999, resolve));
    expect(deniedAck).toBe(false);
    const silent = noEvent(socket, "message:new");
    emitter.toRooms([rooms.ticket(999)], "message:new", { id: 2 });
    await silent;
  });

  it("isolates companies", async () => {
    const { company, connection, contact } = await scenario();
    const other = await createCompany();
    const supB = await createUser(other.id, { profile: "supervisor" });
    const sB = await connect(bearer(supB).slice(7));
    const silent = Promise.all([noEvent(sB, "c:x"), noEvent(sB, "s:x"), noEvent(sB, "ticket:update")]);
    emitter.toCompany(company.id, "c:x", {});
    emitter.toSupervisors(company.id, "s:x", {});
    const ticket = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id });
    await emitTicket(ticket.id);
    await silent;
  });

  it("emits message events to joined ticket room and stops after leave", async () => {
    const { company, connection, contact } = await scenario();
    const agent = await createUser(company.id);
    const socket = await connect(bearer(agent).slice(7));
    const ticket = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id });
    const message = await createMessage(ticket);
    await new Promise((resolve) => socket.emit("ticket:join", ticket.id, resolve));

    const gotNew = nextEvent(socket, "message:new");
    emitMessage(message, "message:new");
    expect(await gotNew).toEqual(JSON.parse(JSON.stringify(message.toJSON())));
    const gotDel = nextEvent(socket, "message:delete");
    emitMessageDeleted(message);
    await expect(gotDel).resolves.toEqual({ id: message.id, ticketId: ticket.id });

    socket.emit("ticket:leave", ticket.id);
    await new Promise((r) => setTimeout(r, 100));
    const silent = noEvent(socket, "message:new");
    emitMessage(message, "message:new");
    await silent;
  });

  it("connects a super-admin outside any company", async () => {
    const sa = await createSuperAdmin();
    const socket = await connect(superAdminBearer(sa).slice(7));
    expect(socket.connected).toBe(true);
  });

  it("refuses and drops the company's users when it is blocked, but not the super-admin", async () => {
    const company = await createCompany();
    const agent = await createUser(company.id);
    const sa = await createSuperAdmin();
    const user = await connect(bearer(agent).slice(7));
    const admin = await connect(superAdminBearer(sa, company.id).slice(7));

    await company.update({ status: "blocked" });
    const notified = nextEvent(user, "company:blocked");
    const dropped = nextEvent(user, "disconnect");
    await disconnectCompany(company.id);
    await expect(notified).resolves.toBeUndefined();
    await expect(dropped).resolves.toBe("io server disconnect");
    expect(admin.connected).toBe(true);

    await expect(connect(bearer(agent).slice(7))).rejects.toThrow("COMPANY_BLOCKED");
  });
});
