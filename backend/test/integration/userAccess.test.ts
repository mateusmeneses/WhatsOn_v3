import request from "supertest";
import { createApp } from "../../src/app";
import { User } from "../../src/models";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCompany, createConnection, createUser } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";

const app = createApp();
const fake = new FakeProvider();

async function setup({ connected = true } = {}) {
  const company = await createCompany();
  const admin = await createUser(company.id, { profile: "admin" });
  if (connected) await createConnection(company.id, { isDefault: true });
  return { company, admin };
}

const newUser = { name: "Bruno", email: "bruno@test.local", phone: "(11) 98888-7777", profile: "agent", sendAccess: true };

describe("user access", () => {
  beforeEach(async () => {
    await resetDb();
    fake.reset();
    setProvider(fake);
  });
  afterAll(() => setProvider(null));

  it("generates a temporary password and sends link, login and password by WhatsApp", async () => {
    const { admin } = await setup();
    const res = await request(app).post("/api/users").set("Authorization", bearer(admin)).send(newUser);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ phone: "5511988887777", mustChangePassword: true, access: { sent: true } });
    expect(res.body.access.temporaryPassword).toBeUndefined();

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.number).toBe("5511988887777");
    const text = fake.sent[0]!.text!;
    expect(text).toContain("http");
    expect(text).toContain("Usuário: bruno@test.local");
    const password = /Senha temporária: (\S+)/.exec(text)![1]!;
    const login = await request(app).post("/api/auth/login").send({ email: "bruno@test.local", password });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
  });

  it("does not send nor reveal the access unless the admin asks to send it", async () => {
    const { admin } = await setup();
    const { sendAccess: _, ...withoutSend } = newUser;
    const res = await request(app).post("/api/users").set("Authorization", bearer(admin)).send(withoutSend);
    expect(res.status).toBe(201);
    expect(res.body.access).toEqual({ sent: false });
    expect(fake.sent).toHaveLength(0);

    const off = await request(app).post("/api/users").set("Authorization", bearer(admin)).send({ ...newUser, email: "c@test.local", sendAccess: false });
    expect(off.body.access).toEqual({ sent: false });
    expect(fake.sent).toHaveLength(0);
  });

  it("sends the access later through reset-access", async () => {
    const { admin } = await setup();
    const { sendAccess: _, ...withoutSend } = newUser;
    const created = await request(app).post("/api/users").set("Authorization", bearer(admin)).send(withoutSend);
    const res = await request(app).post(`/api/users/${created.body.id}/reset-access`).set("Authorization", bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.access).toEqual({ sent: true });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.text).toContain("Usuário: bruno@test.local");
  });

  it("shows the temporary password to the admin when WhatsApp is unavailable", async () => {
    const { admin } = await setup({ connected: false });
    const res = await request(app).post("/api/users").set("Authorization", bearer(admin)).send(newUser);
    expect(res.status).toBe(201);
    expect(res.body.access.sent).toBe(false);
    expect(res.body.access.temporaryPassword).toEqual(expect.any(String));
    expect(fake.sent).toHaveLength(0);
  });

  it("still creates the user when sending fails", async () => {
    const { admin } = await setup();
    fake.failNext("send");
    const res = await request(app).post("/api/users").set("Authorization", bearer(admin)).send(newUser);
    expect(res.status).toBe(201);
    expect(res.body.access).toEqual({ sent: false, temporaryPassword: expect.any(String) });
  });

  it("rejects an invalid phone", async () => {
    const { admin } = await setup();
    const res = await request(app).post("/api/users").set("Authorization", bearer(admin)).send({ ...newUser, phone: "123" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PHONE");
  });

  it("blocks the API until the temporary password is changed", async () => {
    const { company } = await setup();
    const user = await createUser(company.id, { password: "temp1234" });
    await user.update({ mustChangePassword: true });
    const login = await request(app).post("/api/auth/login").send({ email: user.email, password: "temp1234" });
    const token = `Bearer ${login.body.accessToken}`;

    const blocked = await request(app).get("/api/tickets").set("Authorization", token);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect((await request(app).get("/api/auth/me").set("Authorization", token)).status).toBe(200);

    const wrong = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", token)
      .send({ currentPassword: "errada", newPassword: "novaSenha1" });
    expect(wrong.body.error.code).toBe("INVALID_CURRENT_PASSWORD");

    const same = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", token)
      .send({ currentPassword: "temp1234", newPassword: "temp1234" });
    expect(same.body.error.code).toBe("SAME_PASSWORD");

    const changed = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", token)
      .send({ currentPassword: "temp1234", newPassword: "novaSenha1" });
    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);
    const ok = await request(app).get("/api/tickets").set("Authorization", `Bearer ${changed.body.accessToken}`);
    expect(ok.status).toBe(200);

    // A sessão antiga (refresh) cai com a troca.
    const stale = await request(app).post("/api/auth/refresh").send({ refreshToken: login.body.refreshToken });
    expect(stale.status).toBe(401);
  });

  it("resets access with a new temporary password", async () => {
    const { company, admin } = await setup();
    const user = await createUser(company.id, { password: "antiga123" });
    await user.update({ phone: "5511977776666" });
    const res = await request(app).post(`/api/users/${user.id}/reset-access`).set("Authorization", bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.access.sent).toBe(true);
    expect(fake.sent[0]!.number).toBe("5511977776666");
    expect((await User.findByPk(user.id))!.mustChangePassword).toBe(true);
    const old = await request(app).post("/api/auth/login").send({ email: user.email, password: "antiga123" });
    expect(old.status).toBe(401);
  });

  it("marks a password set by the admin as temporary, but not their own", async () => {
    const { company, admin } = await setup();
    const user = await createUser(company.id);
    await request(app).put(`/api/users/${user.id}`).set("Authorization", bearer(admin)).send({ password: "outra123" }).expect(200);
    expect((await User.findByPk(user.id))!.mustChangePassword).toBe(true);
    await request(app).put(`/api/users/${admin.id}`).set("Authorization", bearer(admin)).send({ password: "minha123" }).expect(200);
    expect((await User.findByPk(admin.id))!.mustChangePassword).toBe(false);
  });
});
