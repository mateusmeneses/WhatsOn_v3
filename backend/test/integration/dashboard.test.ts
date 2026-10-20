import http from "node:http";
import { AddressInfo } from "node:net";
import request from "supertest";
import { io as ioc, Socket } from "socket.io-client";
import { createApp } from "../../src/app";
import { TicketLog } from "../../src/models";
import { closeSocket, initSocket } from "../../src/modules/realtime/socket";
import { resolveRange, todayIn } from "../../src/modules/dashboard/dashboard.service";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCompany, createContact, createMessage, createQueue, createTicket, createUser, scenario } from "../helpers/factories";

const app = createApp();
const sec = 1000;
const ago = (ms: number) => new Date(Date.now() - ms);

describe("resolveRange", () => {
  const now = new Date("2026-10-20T15:00:00Z");
  it("builds presets in the company timezone", () => {
    expect(todayIn("America/Sao_Paulo", new Date("2026-10-20T01:00:00Z"))).toBe("2026-10-19");
    expect(resolveRange("today", "UTC", undefined, now)).toEqual({ from: "2026-10-20", to: "2026-10-20", days: 1 });
    expect(resolveRange("yesterday", "UTC", undefined, now)).toEqual({ from: "2026-10-19", to: "2026-10-19", days: 1 });
    expect(resolveRange("7d", "UTC", undefined, now)).toEqual({ from: "2026-10-14", to: "2026-10-20", days: 7 });
    expect(resolveRange("custom", "UTC", { from: "2026-10-10", to: "2026-10-05" }, now)).toEqual({
      from: "2026-10-05",
      to: "2026-10-10",
      days: 6,
    });
  });
});

describe("dashboard API", () => {
  beforeEach(resetDb);

  it("is restricted to admins and supervisors", async () => {
    const company = await createCompany();
    const agent = await createUser(company.id, { profile: "agent" });
    const supervisor = await createUser(company.id, { profile: "supervisor" });
    await request(app).get("/api/dashboard").expect(401);
    await request(app).get("/api/dashboard").set("Authorization", bearer(agent)).expect(403);
    await request(app).get("/api/dashboard").set("Authorization", bearer(supervisor)).expect(200);
  });

  it("validates the period", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, { profile: "admin" });
    const get = (qs: string) => request(app).get(`/api/dashboard?${qs}`).set("Authorization", bearer(admin));
    await get("period=forever").expect(400);
    await get("period=custom").expect(400);
    await get("period=custom&from=2026-01-01&to=2026-01-02x").expect(400);
    await get("period=custom&from=2024-01-01&to=2026-01-01").expect(400);
    await get("period=custom&from=2026-01-01&to=2026-01-31").expect(200);
  });

  it("returns an empty, well-formed payload for a new company", async () => {
    const company = await createCompany({ timezone: "UTC" });
    const admin = await createUser(company.id, { profile: "admin" });
    const res = await request(app).get("/api/dashboard?period=7d").set("Authorization", bearer(admin)).expect(200);
    expect(res.body.timeline).toHaveLength(7);
    expect(res.body.kpis.ticketsCreated).toEqual({ value: 0, previous: 0 });
    expect(res.body.kpis.medianResponse).toEqual({ value: null, previous: null });
    expect(res.body.live).toMatchObject({ bot: 0, pending: 0, open: 0, waitingReply: 0, onlineUsers: 0 });
    expect(res.body.agents).toHaveLength(1);
  });

  it("computes response, wait, movement and ranking metrics", async () => {
    const { company, connection, contact } = await scenario();
    await company.update({ timezone: "UTC" });
    const queue = await createQueue(company.id, { name: "Suporte", color: "#0a6ad6" });
    const admin = await createUser(company.id, { profile: "admin" });
    const ana = await createUser(company.id, { name: "Ana", queueIds: [queue.id] });
    const other = await scenario(); // outra empresa: nunca entra nos números

    // T1: aceito após 120 s, respostas de 300 s e 60 s, finalizado em 600 s.
    const t0 = Date.now() - 2 * 3600 * sec;
    const at = (offset: number) => new Date(t0 + offset * sec);
    const t1 = await createTicket({
      companyId: company.id, contactId: contact.id, connectionId: connection.id, queueId: queue.id,
      userId: ana.id, status: "closed", createdAt: at(0), closedAt: at(600),
    });
    await TicketLog.create({ companyId: company.id, ticketId: t1.id, event: "created", createdAt: at(0) });
    await TicketLog.create({ companyId: company.id, ticketId: t1.id, event: "accepted", userId: ana.id, createdAt: at(120) });
    await TicketLog.create({ companyId: company.id, ticketId: t1.id, event: "closed", userId: ana.id, createdAt: at(600) });
    await createMessage(t1, { createdAt: at(0), body: "oi" });
    await createMessage(t1, { createdAt: at(300), fromMe: true, sentByUserId: ana.id, body: "olá" });
    await createMessage(t1, { createdAt: at(400), body: "obrigado" });
    await createMessage(t1, { createdAt: at(460), fromMe: true, sentByUserId: ana.id, body: "disponha" });

    // T2: cliente esperando há 30 min (a segunda mensagem não abre nova rodada).
    const contact2 = await createContact(company.id, { name: "Cliente Impaciente" });
    const t2 = await createTicket({ companyId: company.id, contactId: contact2.id, connectionId: connection.id, queueId: queue.id, status: "pending" });
    await createMessage(t2, { createdAt: ago(30 * 60 * sec), body: "alô?" });
    await createMessage(t2, { createdAt: ago(29 * 60 * sec), body: "alô??" });

    // T3: atendido só pelo bot (não conta como resposta humana).
    const contact3 = await createContact(company.id);
    const t3 = await createTicket({ companyId: company.id, contactId: contact3.id, connectionId: connection.id, status: "bot" });
    await createMessage(t3, { createdAt: ago(20 * 60 * sec), body: "1" });
    await createMessage(t3, { createdAt: ago(20 * 60 * sec - 5 * sec), fromMe: true, isBot: true, body: "menu" });

    // T4: resposta lenta de 1 h.
    const contact4 = await createContact(company.id, { name: "Cliente Lento" });
    const t4 = await createTicket({ companyId: company.id, contactId: contact4.id, connectionId: connection.id, queueId: queue.id, userId: ana.id, status: "open" });
    await createMessage(t4, { createdAt: ago(4 * 3600 * sec), body: "preciso de ajuda" });
    await createMessage(t4, { createdAt: ago(3 * 3600 * sec), fromMe: true, sentByUserId: ana.id, body: "claro" });

    // Dados de outra empresa.
    const foreign = await createTicket({ companyId: other.company.id, contactId: other.contact.id, connectionId: other.connection.id });
    await createMessage(foreign, { createdAt: ago(60 * sec) });

    // Presença via Socket.io.
    const server = http.createServer();
    initSocket(server, { canJoinTicket: async () => true });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    const socket: Socket = ioc(`http://localhost:${port}`, { auth: { token: bearer(ana).slice(7) }, transports: ["websocket"], forceNew: true });
    await new Promise<void>((resolve, reject) => {
      socket.once("ready", () => resolve());
      socket.once("connect_error", reject);
    });

    try {
      const res = await request(app).get("/api/dashboard?period=7d").set("Authorization", bearer(admin)).expect(200);
      const d = res.body;

      expect(d.kpis.ticketsCreated.value).toBe(4);
      expect(d.kpis.ticketsClosed.value).toBe(1);
      expect(d.kpis.avgResolution.value).toBeCloseTo(600, 0);
      expect(d.kpis.messagesIn.value).toBe(6);
      expect(d.kpis.messagesOut.value).toBe(3);
      expect(d.kpis.messagesBot.value).toBe(1);

      // Respostas humanas: 300 s, 60 s e 3600 s.
      expect(d.kpis.avgResponse.value).toBeCloseTo(1320, 0);
      expect(d.kpis.medianResponse.value).toBeCloseTo(300, 0);
      expect(d.kpis.responseWithinSla.value).toBeCloseTo(66.67, 1);
      expect(d.kpis.avgAcceptWait.value).toBeCloseTo(120, 0);

      expect(d.slowestResponses[0]).toMatchObject({ contactName: "Cliente Lento", agentName: "Ana" });
      expect(d.slowestResponses[0].seconds).toBeCloseTo(3600, 0);
      expect(d.slowestResponses).toHaveLength(3);

      expect(d.live).toMatchObject({ bot: 1, pending: 1, open: 1, waitingReply: 1, onlineUsers: 1 });
      expect(d.waitingNow[0]).toMatchObject({ contactName: "Cliente Impaciente", status: "pending" });
      expect(new Date(d.live.oldestPendingSince).getTime()).toBeLessThan(Date.now());

      const agent = d.agents.find((a: { name: string }) => a.name === "Ana");
      expect(agent).toMatchObject({ online: true, openNow: 1, accepted: 1, closed: 1, messagesSent: 3 });
      expect(agent.avgResponse).toBeCloseTo(1320, 0);
      expect(agent.avgAcceptWait).toBeCloseTo(120, 0);
      expect(d.agents[0].name).toBe("Ana"); // online primeiro
      expect(d.agents.find((a: { name: string }) => a.name !== "Ana").online).toBe(false);

      expect(d.movement).toMatchObject({ accepted: 1, closed: 1 });
      expect(d.bot).toMatchObject({ handled: 1, resolvedByBot: 0 });
      expect(d.byQueue.find((q: { name: string }) => q.name === "Suporte")).toMatchObject({ created: 3, closed: 1, waiting: 1 });
      expect(d.topContacts[0].tickets).toBeGreaterThanOrEqual(1);
      expect(d.topContacts.some((c: { name: string }) => c.name === "Cliente Lento")).toBe(true);
      expect(d.byConnection[0]).toMatchObject({ id: connection.id, tickets: 4 });
      expect(d.heatmap.reduce((n: number, h: { count: number }) => n + h.count, 0)).toBe(6);
      expect(d.timeline.reduce((n: number, x: { inbound: number }) => n + x.inbound, 0)).toBe(6);
      expect(d.recentActivity.length).toBe(3);
    } finally {
      socket.disconnect();
      await closeSocket();
    }
  });
});
