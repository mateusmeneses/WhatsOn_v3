import bcrypt from "bcryptjs";
import { Job } from "bullmq";
import request from "supertest";
import { createApp } from "../../src/app";
import { ensureSuperAdmin } from "../../src/database/seed";
import { Company, Message, ScheduledMessage, User } from "../../src/models";
import { handleInboundEvent } from "../../src/modules/inbound/inbound";
import { createOutgoingMessage } from "../../src/modules/messages/messages.service";
import { OutboundJob, processOutboundJob } from "../../src/modules/messages/outbound";
import { dispatchDueScheduled } from "../../src/modules/scheduled/scheduled.service";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { parseEvolutionWebhook } from "../../src/modules/whatsapp/evolution/parseWebhook";
import { bearer, superAdminBearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCompany, createSuperAdmin, createTicket, createUser, scenario } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";
import { resetRedis } from "../helpers/redis";
import { textMessage } from "../fixtures/evolution";

const app = createApp();
const fake = new FakeProvider();

async function loginAs(email: string, password = "secret123") {
  return request(app).post("/api/auth/login").send({ email, password });
}

describe("super-admin", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    fake.reset();
    setProvider(fake);
  });
  afterAll(() => setProvider(null));

  describe("login and session", () => {
    it("logs in without a company and only reaches /auth and /admin", async () => {
      const sa = await createSuperAdmin({ email: "root@test.local" });
      const res = await loginAs("root@test.local");
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ id: sa.id, companyId: null, profile: "superadmin", superAdmin: true });
      const auth = `Bearer ${res.body.accessToken}`;

      expect((await request(app).get("/api/auth/me").set("Authorization", auth)).body).toMatchObject({ superAdmin: true });
      expect((await request(app).get("/api/admin/companies").set("Authorization", auth)).status).toBe(200);
      const tenant = await request(app).get("/api/tickets").set("Authorization", auth);
      expect(tenant.status).toBe(403);
      expect(tenant.body.error.code).toBe("COMPANY_REQUIRED");
    });

    it("forbids /admin to company users", async () => {
      const company = await createCompany();
      const admin = await createUser(company.id, { profile: "admin" });
      const res = await request(app).get("/api/admin/companies").set("Authorization", bearer(admin));
      expect(res.status).toBe(403);
    });
  });

  describe("companies", () => {
    it("lists companies with user counts", async () => {
      const sa = await createSuperAdmin();
      const a = await createCompany({ name: "Alfa" });
      await createUser(a.id);
      await createUser(a.id);
      await createCompany({ name: "Beta" });
      const res = await request(app).get("/api/admin/companies").set("Authorization", superAdminBearer(sa));
      expect(res.body).toEqual([
        expect.objectContaining({ name: "Alfa", status: "active", userCount: 2 }),
        expect.objectContaining({ name: "Beta", status: "active", userCount: 0 }),
      ]);
    });

    it("creates a company with its first admin on a temporary password", async () => {
      const sa = await createSuperAdmin();
      const res = await request(app)
        .post("/api/admin/companies")
        .set("Authorization", superAdminBearer(sa))
        .send({ name: "Loja Nova", timezone: "America/Manaus", admin: { name: "Ana", email: "Ana@Loja.com", phone: "11 98888-7777" } });
      expect(res.status).toBe(201);
      expect(res.body.company).toMatchObject({ name: "Loja Nova", timezone: "America/Manaus", status: "active", userCount: 1 });
      expect(res.body.admin).toMatchObject({ name: "Ana", email: "ana@loja.com", phone: "5511988887777", profile: "admin" });
      const password = res.body.temporaryPassword as string;
      expect(password).toHaveLength(10);

      const user = await User.findOne({ where: { email: "ana@loja.com" } });
      expect(user).toMatchObject({ companyId: res.body.company.id, mustChangePassword: true });
      expect(await bcrypt.compare(password, user!.passwordHash)).toBe(true);
    });

    it("rejects a duplicated admin e-mail without leaving the company behind", async () => {
      const sa = await createSuperAdmin();
      const other = await createCompany();
      await createUser(other.id, { email: "dup@test.local" });
      const res = await request(app)
        .post("/api/admin/companies")
        .set("Authorization", superAdminBearer(sa))
        .send({ name: "X", admin: { name: "A", email: "dup@test.local" } });
      expect(res.status).toBe(409);
      expect(await Company.count()).toBe(1);
    });

    it("updates name and time zone", async () => {
      const sa = await createSuperAdmin();
      const company = await createCompany();
      const res = await request(app)
        .put(`/api/admin/companies/${company.id}`)
        .set("Authorization", superAdminBearer(sa))
        .send({ name: "Renomeada", timezone: "America/Recife" });
      expect(res.body).toMatchObject({ name: "Renomeada", timezone: "America/Recife" });
      const bad = await request(app)
        .put(`/api/admin/companies/${company.id}`)
        .set("Authorization", superAdminBearer(sa))
        .send({ timezone: "Mars/Base" });
      expect(bad.status).toBe(400);
    });
  });

  describe("entering a company", () => {
    it("acts as admin of the chosen company and keeps it across refresh", async () => {
      await createSuperAdmin({ email: "root@test.local" });
      const company = await createCompany({ name: "Cliente" });
      await createUser(company.id, { name: "Fulano" });
      const login = await loginAs("root@test.local");

      const enter = await request(app)
        .post(`/api/admin/companies/${company.id}/enter`)
        .set("Authorization", `Bearer ${login.body.accessToken}`);
      expect(enter.status).toBe(200);
      expect(enter.body.user).toMatchObject({ companyId: company.id, profile: "admin", superAdmin: true });
      const auth = `Bearer ${enter.body.accessToken}`;

      expect((await request(app).get("/api/company").set("Authorization", auth)).body).toMatchObject({ name: "Cliente" });
      const users = await request(app).get("/api/users").set("Authorization", auth);
      expect(users.body.map((u: { name: string }) => u.name)).toEqual(["Fulano"]);

      const refreshed = await request(app).post("/api/auth/refresh").send({ refreshToken: enter.body.refreshToken });
      expect(refreshed.body.user).toMatchObject({ companyId: company.id, profile: "admin" });

      const exit = await request(app).post("/api/admin/exit").set("Authorization", auth);
      expect(exit.body.user).toMatchObject({ companyId: null, profile: "superadmin" });
    });

    it("returns 404 for an unknown company", async () => {
      const sa = await createSuperAdmin();
      const res = await request(app).post("/api/admin/companies/999/enter").set("Authorization", superAdminBearer(sa));
      expect(res.status).toBe(404);
    });
  });

  describe("blocking", () => {
    async function block(companyId: number, sa: User) {
      const res = await request(app).post(`/api/admin/companies/${companyId}/block`).set("Authorization", superAdminBearer(sa));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("blocked");
    }

    it("refuses login, live tokens and refresh of the company's users until unblocked", async () => {
      const sa = await createSuperAdmin();
      const company = await createCompany();
      const admin = await createUser(company.id, { profile: "admin", email: "adm@test.local" });
      const before = await loginAs("adm@test.local");

      await block(company.id, sa);

      const login = await loginAs("adm@test.local");
      expect(login.status).toBe(403);
      expect(login.body.error.code).toBe("COMPANY_BLOCKED");
      const live = await request(app).get("/api/tickets").set("Authorization", bearer(admin));
      expect(live.status).toBe(403);
      expect(live.body.error.code).toBe("COMPANY_BLOCKED");
      expect((await request(app).post("/api/auth/refresh").send({ refreshToken: before.body.refreshToken })).status).toBe(401);

      await request(app).post(`/api/admin/companies/${company.id}/unblock`).set("Authorization", superAdminBearer(sa)).expect(200);
      expect((await loginAs("adm@test.local")).status).toBe(200);
    });

    it("lets the super-admin read a blocked company but not change it", async () => {
      const sa = await createSuperAdmin();
      const company = await createCompany();
      await block(company.id, sa);
      const auth = superAdminBearer(sa, company.id);
      expect((await request(app).get("/api/company").set("Authorization", auth)).status).toBe(200);
      const write = await request(app).put("/api/company").set("Authorization", auth).send({ name: "Y" });
      expect(write.status).toBe(403);
      expect(write.body.error.code).toBe("COMPANY_BLOCKED");
    });

    it("rejects the external API of a blocked company", async () => {
      const sa = await createSuperAdmin();
      const { company, connection } = await scenario();
      await connection.update({ apiToken: "b".repeat(64) });
      await block(company.id, sa);
      const res = await request(app).get("/api/v1/connection/status").set("Authorization", `Bearer ${"b".repeat(64)}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("COMPANY_BLOCKED");
    });

    it("drops inbound messages, outbound sends and due scheduled messages", async () => {
      const sa = await createSuperAdmin();
      const { company, connection, contact } = await scenario();
      const agent = await createUser(company.id);
      const ticket = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, status: "open", userId: agent.id });
      const pending = await createOutgoingMessage(ticket, { body: "antes do bloqueio", sentByUserId: agent.id });
      const scheduled = await ScheduledMessage.create({
        companyId: company.id,
        ticketId: ticket.id,
        userId: agent.id,
        body: "agendada",
        sendAt: new Date(Date.now() - 1000),
      });
      await block(company.id, sa);

      for (const event of parseEvolutionWebhook(textMessage({ from: "5511977776666", text: "oi" }))) {
        await handleInboundEvent({ connectionId: connection.id, event }, { finalAttempt: true });
      }
      expect(await Message.count({ where: { fromMe: false } })).toBe(0);

      await processOutboundJob({ data: { messageId: pending.id }, attemptsMade: 0, opts: { attempts: 5 } } as unknown as Job<OutboundJob>);
      expect(fake.sent).toHaveLength(0);
      expect((await pending.reload()).ack).toBe("failed");

      await dispatchDueScheduled();
      await scheduled.reload();
      expect(scheduled.status).toBe("failed");
      expect(scheduled.error).toBe("Empresa bloqueada");
    });
  });

  describe("seed", () => {
    it("creates the configured super-admin once", async () => {
      await ensureSuperAdmin("root@seed.local", "senha-forte-123");
      await ensureSuperAdmin("root@seed.local", "outra-senha-456");
      const users = await User.findAll({ where: { email: "root@seed.local" } });
      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({ profile: "superadmin", companyId: null });
      expect(await bcrypt.compare("senha-forte-123", users[0]!.passwordHash)).toBe(true);
    });
  });
});
