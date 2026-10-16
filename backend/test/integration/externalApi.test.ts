import dns from "node:dns";
import { Job } from "bullmq";
import express from "express";
import nock from "nock";
import request from "supertest";
import { createApp } from "../../src/app";
import { Connection, Contact, Message, Ticket } from "../../src/models";
import { rateLimitByConnection } from "../../src/modules/externalApi/rateLimit";
import { OutboundJob, processOutboundJob } from "../../src/modules/messages/outbound";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { errorHandler } from "../../src/shared/errors/errorHandler";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCompany, createConnection, createContact, createTicket, createUser } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";
import { resetRedis } from "../helpers/redis";

const app = createApp();
const fake = new FakeProvider();
const TOKEN = "a".repeat(64);
const job = (messageId: number) => ({ data: { messageId }, attemptsMade: 0, opts: { attempts: 5 } }) as unknown as Job<OutboundJob>;

async function apiConnection(attrs: Record<string, unknown> = {}) {
  const company = await createCompany();
  const connection = await createConnection(company.id, { apiToken: TOKEN, ...attrs });
  return { company, connection };
}

const auth = (token = TOKEN) => `Bearer ${token}`;

describe("external API (/api/v1)", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    fake.reset();
    setProvider(fake);
  });
  afterAll(() => setProvider(null));

  describe("auth", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).get("/api/v1/connection/status");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("returns 403 with an invalid token", async () => {
      await apiConnection();
      const res = await request(app).get("/api/v1/connection/status").set("Authorization", auth("nao-existe"));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("INVALID_API_TOKEN");
    });

    it("does not accept the webhook token nor a panel JWT", async () => {
      const { company, connection } = await apiConnection();
      const user = await createUser(company.id, { profile: "admin" });
      const byWebhook = await request(app).get("/api/v1/connection/status").set("Authorization", auth(connection.webhookToken));
      expect(byWebhook.status).toBe(403);
      const byJwt = await request(app).get("/api/v1/connection/status").set("Authorization", bearer(user));
      expect(byJwt.status).toBe(403);
    });

    it("returns the connection status with a valid token", async () => {
      await apiConnection({ number: "5511999990000" });
      const res = await request(app).get("/api/v1/connection/status").set("Authorization", auth());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "connected", number: "5511999990000" });
      expect(res.headers["x-ratelimit-limit"]).toBe("60");
    });
  });

  describe("send", () => {
    it("sends text through the outbound flow and records it on a ticket", async () => {
      const { connection } = await apiConnection();
      const res = await request(app)
        .post("/api/v1/messages/send")
        .set("Authorization", auth())
        .send({ number: "(11) 98888-7777", body: "Seu pedido saiu para entrega" });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ number: "5511988887777", messages: [{ type: "text", ack: "pending" }] });

      const ticket = await Ticket.findByPk(res.body.ticketId);
      expect(ticket).toMatchObject({ connectionId: connection.id, status: "open", lastMessage: "Seu pedido saiu para entrega" });
      const contact = await Contact.findByPk(ticket!.contactId);
      expect(contact!.number).toBe("5511988887777");

      await processOutboundJob(job(res.body.messages[0].id));
      expect(fake.sent).toEqual([
        { instanceName: connection.instanceName, number: "5511988887777", text: "Seu pedido saiu para entrega", quoted: undefined },
      ]);
      expect(await Message.findByPk(res.body.messages[0].id)).toMatchObject({ ack: "sent", fromMe: true, sentByUserId: null });
    });

    it("reuses the open ticket of the contact and the number returned by WhatsApp", async () => {
      const { company, connection } = await apiConnection();
      const contact = await createContact(company.id, { number: "553188887777" });
      const ticket = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, status: "pending" });
      fake.jidOverrides.set("5531988887777", "553188887777@s.whatsapp.net");
      const res = await request(app)
        .post("/api/v1/messages/send")
        .set("Authorization", auth())
        .send({ number: "5531988887777", body: "oi" });
      expect(res.status).toBe(201);
      expect(res.body.ticketId).toBe(ticket.id);
      expect(res.body.contactId).toBe(contact.id);
      expect(await Ticket.count()).toBe(1);
    });

    it("sends multipart medias with the body as caption of the first file", async () => {
      const { connection } = await apiConnection();
      const res = await request(app)
        .post("/api/v1/messages/send")
        .set("Authorization", auth())
        .field("number", "11988887777")
        .field("body", "segue o boleto")
        .attach("medias", Buffer.from("PDF"), { filename: "boleto.pdf", contentType: "application/pdf" })
        .attach("medias", Buffer.from("IMG"), { filename: "foto.png", contentType: "image/png" });
      expect(res.status).toBe(201);
      expect(res.body.messages.map((m: { type: string }) => m.type)).toEqual(["document", "image"]);

      for (const m of res.body.messages) await processOutboundJob(job(m.id));
      expect(fake.sent[0]).toMatchObject({
        instanceName: connection.instanceName,
        number: "5511988887777",
        media: { type: "document", mimetype: "application/pdf", fileName: "boleto.pdf", caption: "segue o boleto", base64: Buffer.from("PDF").toString("base64") },
      });
      expect(fake.sent[1].media).toMatchObject({ type: "image", caption: undefined });
    });

    it("sends media downloaded from a URL", async () => {
      await apiConnection();
      const lookup = jest
        .spyOn(dns.promises, "lookup")
        .mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
      nock("http://files.example.com").get("/docs/nota.pdf").reply(200, Buffer.from("NOTA"), { "Content-Type": "application/pdf" });
      try {
        const res = await request(app)
          .post("/api/v1/messages/send-media-url")
          .set("Authorization", auth())
          .send({ number: "5511988887777", url: "http://files.example.com/docs/nota.pdf", caption: "NF-e" });
        expect(res.status).toBe(201);
        const message = await Message.findByPk(res.body.messages[0].id);
        expect(message).toMatchObject({ type: "document", mediaMime: "application/pdf", mediaName: "nota.pdf", body: "NF-e" });
      } finally {
        lookup.mockRestore();
        nock.cleanAll();
      }
    });

    it("refuses media URLs pointing to the internal network", async () => {
      await apiConnection();
      const res = await request(app)
        .post("/api/v1/messages/send-media-url")
        .set("Authorization", auth())
        .send({ number: "5511988887777", url: "http://127.0.0.1:4000/health" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_MEDIA_URL");
    });

    it("validates the payload and the connection state", async () => {
      const { connection } = await apiConnection();
      const empty = await request(app).post("/api/v1/messages/send").set("Authorization", auth()).send({ number: "5511988887777" });
      expect(empty.status).toBe(400);
      expect(empty.body.error.code).toBe("VALIDATION_ERROR");

      const badNumber = await request(app).post("/api/v1/messages/send").set("Authorization", auth()).send({ number: "123", body: "x" });
      expect(badNumber.status).toBe(400);
      expect(badNumber.body.error.code).toBe("INVALID_PHONE");

      fake.missingNumbers.add("5511900000000");
      const missing = await request(app)
        .post("/api/v1/messages/send")
        .set("Authorization", auth())
        .send({ number: "5511900000000", body: "x" });
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe("NUMBER_NOT_ON_WHATSAPP");

      await connection.update({ status: "disconnected" });
      const offline = await request(app).post("/api/v1/messages/send").set("Authorization", auth()).send({ number: "5511988887777", body: "x" });
      expect(offline.status).toBe(409);
      expect(offline.body.error.code).toBe("CONNECTION_NOT_CONNECTED");
      expect(await Message.count()).toBe(0);
    });
  });

  describe("connection", () => {
    it("returns the QR code and recreates a lost instance", async () => {
      const { connection } = await apiConnection({ status: "disconnected" });
      fake.lostInstances.add(connection.instanceName);
      const res = await request(app).get("/api/v1/connection/qrcode").set("Authorization", auth());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ qrcode: "data:image/png;base64,FAKEQR", status: "qrcode" });
      expect(fake.instances.has(connection.instanceName)).toBe(true);
    });

    it("returns no QR code when already connected", async () => {
      await apiConnection();
      const res = await request(app).get("/api/v1/connection/qrcode").set("Authorization", auth());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ qrcode: null, status: "connected" });
    });

    it("logs out the connection", async () => {
      const { connection } = await apiConnection();
      const res = await request(app).post("/api/v1/connection/logout").set("Authorization", auth());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "disconnected" });
      expect((await Connection.findByPk(connection.id))!.status).toBe("disconnected");
    });
  });

  describe("contacts/check", () => {
    it("tells whether the number is on WhatsApp", async () => {
      await apiConnection();
      fake.missingNumbers.add("5511900000000");
      const yes = await request(app).post("/api/v1/contacts/check").set("Authorization", auth()).send({ number: "11988887777" });
      expect(yes.body).toEqual({ exists: true, jid: "5511988887777@s.whatsapp.net" });
      const no = await request(app).post("/api/v1/contacts/check").set("Authorization", auth()).send({ number: "5511900000000" });
      expect(no.body).toEqual({ exists: false, jid: null });
    });
  });

  describe("rate limit", () => {
    it("answers 429 after the limit per token", async () => {
      const { connection } = await apiConnection();
      const mini = express();
      mini.use((req, _res, next) => {
        req.apiConnection = connection;
        next();
      });
      mini.get("/", rateLimitByConnection(2), (_req, res) => {
        res.json({ ok: true });
      });
      mini.use(errorHandler);
      expect((await request(mini).get("/")).status).toBe(200);
      expect((await request(mini).get("/")).status).toBe(200);
      const blocked = await request(mini).get("/");
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("RATE_LIMITED");
      expect(blocked.headers["retry-after"]).toBeDefined();
    });
  });
});

describe("connection API token (admin)", () => {
  beforeEach(async () => {
    await resetDb();
    fake.reset();
    setProvider(fake);
  });
  afterAll(() => setProvider(null));

  it("generates, shows and regenerates the token only for admins and hides it from the list", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, { profile: "admin" });
    const agent = await createUser(company.id, { profile: "agent" });
    const connection = await createConnection(company.id);

    const empty = await request(app).get(`/api/connections/${connection.id}/api-token`).set("Authorization", bearer(admin));
    expect(empty.body).toEqual({ apiToken: null });

    const first = await request(app).post(`/api/connections/${connection.id}/api-token`).set("Authorization", bearer(admin));
    expect(first.status).toBe(200);
    expect(first.body.apiToken).toMatch(/^[a-f0-9]{64}$/);

    const second = await request(app).post(`/api/connections/${connection.id}/api-token`).set("Authorization", bearer(admin));
    expect(second.body.apiToken).not.toBe(first.body.apiToken);
    const old = await request(app).get("/api/v1/connection/status").set("Authorization", auth(first.body.apiToken));
    expect(old.status).toBe(403);
    const current = await request(app).get("/api/v1/connection/status").set("Authorization", auth(second.body.apiToken));
    expect(current.status).toBe(200);

    const denied = await request(app).get(`/api/connections/${connection.id}/api-token`).set("Authorization", bearer(agent));
    expect(denied.status).toBe(403);

    const list = await request(app).get("/api/connections").set("Authorization", bearer(agent));
    expect(list.body[0].apiToken).toBeUndefined();
    expect(list.body[0].hasApiToken).toBe(true);
  });

  it("does not expose a token of another company", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, { profile: "admin" });
    const other = await createConnection((await createCompany()).id);
    const res = await request(app).post(`/api/connections/${other.id}/api-token`).set("Authorization", bearer(admin));
    expect(res.status).toBe(404);
  });
});
