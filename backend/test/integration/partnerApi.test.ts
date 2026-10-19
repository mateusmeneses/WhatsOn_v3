import express from "express";
import request from "supertest";
import { createApp } from "../../src/app";
import { Company, Connection, Message, Partner, Ticket } from "../../src/models";
import { handleInboundEvent } from "../../src/modules/inbound/inbound";
import { rateLimitBy } from "../../src/modules/externalApi/rateLimit";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { parseEvolutionWebhook } from "../../src/modules/whatsapp/evolution/parseWebhook";
import { errorHandler } from "../../src/shared/errors/errorHandler";
import { bearer, superAdminBearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCompany, createConnection, createPartner, createSuperAdmin, createUser } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";
import { resetRedis } from "../helpers/redis";
import { textMessage } from "../fixtures/evolution";

const app = createApp();
const fake = new FakeProvider();
const CNPJ = "12345678000195";
const CNPJ_FMT = "12.345.678/0001-95";
const BODY = { cnpj: CNPJ_FMT, name: "Loja X Comércio Ltda", tradeName: "Loja X", email: "contato@lojax.com", phone: "79999990000" };

const auth = (key: string) => `Bearer ${key}`;
const upsert = (key: string, body: object = BODY) =>
  request(app).post("/api/partner/v1/companies").set("Authorization", auth(key)).send(body);

describe("partner API (/api/partner/v1)", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    fake.reset();
    setProvider(fake);
  });
  afterAll(() => setProvider(null));

  describe("auth", () => {
    it("returns 401 without a key and 403 with an unknown one", async () => {
      const none = await request(app).get(`/api/partner/v1/companies/${CNPJ}`);
      expect(none.status).toBe(401);
      expect(none.body.error.code).toBe("UNAUTHENTICATED");
      const bad = await request(app).get(`/api/partner/v1/companies/${CNPJ}`).set("Authorization", auth("wpk_nao-existe"));
      expect(bad.status).toBe(403);
      expect(bad.body.error.code).toBe("INVALID_PARTNER_KEY");
    });

    it("refuses a regenerated key and a revoked partner", async () => {
      const sa = await createSuperAdmin();
      const { partner, key } = await createPartner();
      await request(app).post(`/api/admin/partners/${partner.id}/regenerate-key`).set("Authorization", superAdminBearer(sa));
      expect((await upsert(key)).status).toBe(403);

      const other = await createPartner({ status: "revoked" });
      const res = await upsert(other.key);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("INVALID_PARTNER_KEY");
    });

    it("does not mix partner keys, connection tokens and panel JWTs", async () => {
      const { key } = await createPartner();
      const created = await upsert(key);
      const token = created.body.apiToken as string;
      const user = await createUser(created.body.company.id, { profile: "admin" });

      expect((await upsert(token)).status).toBe(403);
      expect((await request(app).post("/api/partner/v1/companies").set("Authorization", bearer(user)).send(BODY)).status).toBe(403);
      const keyOnV1 = await request(app).get("/api/v1/connection/status").set("Authorization", auth(key));
      expect(keyOnV1.status).toBe(403);
      expect(keyOnV1.body.error.code).toBe("INVALID_API_TOKEN");
    });

    it("records when the key was last used", async () => {
      const { partner, key } = await createPartner();
      await request(app).get(`/api/partner/v1/companies/${CNPJ}`).set("Authorization", auth(key));
      expect((await partner.reload()).lastUsedAt).toBeInstanceOf(Date);
    });
  });

  describe("POST /companies", () => {
    it("creates the company, its connection and the API token", async () => {
      const { partner, key } = await createPartner();
      const res = await upsert(key);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        company: { id: expect.any(Number), cnpj: CNPJ, name: "Loja X", status: "active", createdAt: expect.any(String) },
        connection: { id: expect.any(Number), status: "qrcode", number: null },
        apiToken: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(fake.instances.size).toBe(1);

      const company = await Company.findByPk(res.body.company.id);
      expect(company).toMatchObject({ partnerId: partner.id, contactEmail: "contato@lojax.com", contactPhone: "79999990000" });
      const connection = await Connection.findByPk(res.body.connection.id);
      expect(connection).toMatchObject({ companyId: company!.id, name: "WhatsApp", isDefault: true, defaultQueueId: null });

      const status = await request(app).get("/api/v1/connection/status").set("Authorization", auth(res.body.apiToken));
      expect(status.status).toBe(200);
    });

    it("is idempotent by CNPJ, formatted or not, and keeps the token", async () => {
      const { key } = await createPartner();
      const first = await upsert(key);
      const again = await upsert(key, { ...BODY, cnpj: CNPJ, tradeName: undefined, name: "Novo Nome Ltda" });
      expect(again.status).toBe(200);
      expect(again.body.apiToken).toBe(first.body.apiToken);
      expect(again.body.company).toMatchObject({ id: first.body.company.id, name: "Novo Nome Ltda" });
      expect(fake.instances.size).toBe(1);
      expect(await Company.count()).toBe(1);
      expect(await Connection.count()).toBe(1);
    });

    it("creates a single company and connection under concurrent calls", async () => {
      const { key } = await createPartner();
      const results = await Promise.all([upsert(key), upsert(key), upsert(key)]);
      for (const r of results) expect([200, 201]).toContain(r.status);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(new Set(results.map((r) => r.body.apiToken)).size).toBe(1);
      expect(await Company.count()).toBe(1);
      expect(await Connection.count()).toBe(1);
      expect(fake.instances.size).toBe(1);
    });

    it("accepts the alphanumeric CNPJ", async () => {
      const { key } = await createPartner();
      const res = await upsert(key, { ...BODY, cnpj: "12.abc.345/01de-35" });
      expect(res.status).toBe(201);
      expect(res.body.company.cnpj).toBe("12ABC34501DE35");
    });

    it("rejects an invalid CNPJ or a missing name", async () => {
      const { key } = await createPartner();
      const bad = await upsert(key, { ...BODY, cnpj: "12345678000196" });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe("INVALID_CNPJ");
      const noName = await upsert(key, { cnpj: CNPJ });
      expect(noName.status).toBe(400);
      expect(noName.body.error.code).toBe("VALIDATION_ERROR");
      expect(await Company.count()).toBe(0);
    });

    it("refuses a CNPJ owned by the panel or by another partner without leaking it", async () => {
      const { key } = await createPartner();
      const other = await createPartner();
      await createCompany({ cnpj: CNPJ });
      await createCompany({ cnpj: "12ABC34501DE35", partnerId: other.partner.id });

      const panel = await upsert(key);
      expect(panel.status).toBe(409);
      expect(panel.body).toEqual({ error: { code: "CNPJ_IN_USE", message: expect.any(String) } });
      const foreign = await upsert(key, { ...BODY, cnpj: "12ABC34501DE35" });
      expect(foreign.status).toBe(409);
      expect(fake.instances.size).toBe(0);
    });

    it("finishes on the next call when the provider fails", async () => {
      const { key } = await createPartner();
      fake.failNext("createInstance");
      const failed = await upsert(key);
      expect(failed.status).toBe(502);
      expect(await Company.count()).toBe(1);
      expect(await Connection.count()).toBe(0);

      const retry = await upsert(key);
      expect(retry.status).toBe(200);
      expect(retry.body.connection.status).toBe("qrcode");
      expect(retry.body.apiToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it("reports a blocked company without unblocking or creating anything", async () => {
      const { key } = await createPartner();
      const first = await upsert(key);
      await Company.update({ status: "blocked" }, { where: { id: first.body.company.id } });
      const res = await upsert(key, { ...BODY, name: "Outro" });
      expect(res.status).toBe(200);
      expect(res.body.company.status).toBe("blocked");
      expect(res.body.company.name).toBe("Loja X");
      expect(await Connection.count()).toBe(1);
    });

    it("uses the default connection when the company has several", async () => {
      const { key } = await createPartner();
      const first = await upsert(key);
      const extra = await createConnection(first.body.company.id, { isDefault: false, apiToken: "b".repeat(64) });
      const res = await upsert(key);
      expect(res.body.connection.id).toBe(first.body.connection.id);
      expect(res.body.connection.id).not.toBe(extra.id);
    });
  });

  describe("GET /companies/:cnpj", () => {
    it("returns the partner's company and hides the others", async () => {
      const { key } = await createPartner();
      const other = await createPartner();
      const created = await upsert(key);

      for (const cnpj of [CNPJ, encodeURIComponent(CNPJ_FMT)]) {
        const res = await request(app).get(`/api/partner/v1/companies/${cnpj}`).set("Authorization", auth(key));
        expect(res.status).toBe(200);
        expect(res.body).toEqual(created.body);
      }
      const foreign = await request(app).get(`/api/partner/v1/companies/${CNPJ}`).set("Authorization", auth(other.key));
      expect(foreign.status).toBe(404);
      const unknown = await request(app).get("/api/partner/v1/companies/12ABC34501DE35").set("Authorization", auth(key));
      expect(unknown.status).toBe(404);
    });
  });

  describe("POST /companies/:cnpj/api-token", () => {
    it("replaces the token and the old one stops working", async () => {
      const { key } = await createPartner();
      const created = await upsert(key);
      const res = await request(app).post(`/api/partner/v1/companies/${CNPJ}/api-token`).set("Authorization", auth(key));
      expect(res.status).toBe(200);
      expect(res.body.apiToken).toMatch(/^[0-9a-f]{64}$/);
      expect(res.body.apiToken).not.toBe(created.body.apiToken);

      const old = await request(app).get("/api/v1/connection/status").set("Authorization", auth(created.body.apiToken));
      expect(old.status).toBe(403);
      const fresh = await request(app).get("/api/v1/connection/status").set("Authorization", auth(res.body.apiToken));
      expect(fresh.status).toBe(200);
    });

    it("refuses another partner's company and a blocked one", async () => {
      const { key } = await createPartner();
      const other = await createPartner();
      const created = await upsert(key);
      const foreign = await request(app).post(`/api/partner/v1/companies/${CNPJ}/api-token`).set("Authorization", auth(other.key));
      expect(foreign.status).toBe(404);

      await Company.update({ status: "blocked" }, { where: { id: created.body.company.id } });
      const blocked = await request(app).post(`/api/partner/v1/companies/${CNPJ}/api-token`).set("Authorization", auth(key));
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe("COMPANY_BLOCKED");
    });
  });

  describe("partner companies", () => {
    it("store inbound messages without any automatic reply", async () => {
      const { key } = await createPartner();
      const created = await upsert(key);
      const connection = await Connection.findByPk(created.body.connection.id);
      await connection!.update({ status: "connected" });

      for (const event of parseEvolutionWebhook(textMessage({ from: "5579988887777", text: "pode confirmar?" }))) {
        await handleInboundEvent({ connectionId: connection!.id, event }, { finalAttempt: true });
      }
      expect(await Message.count({ where: { fromMe: false } })).toBe(1);
      expect((await Ticket.findOne())?.status).toBe("pending");
      expect(fake.sent).toHaveLength(0);
    });
  });

  describe("rate limit", () => {
    it("limits each partner on its own window", async () => {
      const mini = express();
      mini.use((req, _res, next) => {
        req.partner = { id: Number(req.headers["x-partner"]) } as Partner;
        next();
      });
      mini.get("/", rateLimitBy("test:rl", (req) => req.partner?.id, 2), (_req, res) => {
        res.json({ ok: true });
      });
      mini.use(errorHandler);
      const hit = (id: number) => request(mini).get("/").set("x-partner", String(id));
      expect((await hit(1)).status).toBe(200);
      expect((await hit(1)).status).toBe(200);
      const blocked = await hit(1);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("RATE_LIMITED");
      expect(blocked.headers["retry-after"]).toBeDefined();
      expect((await hit(2)).status).toBe(200);
    });
  });
});
