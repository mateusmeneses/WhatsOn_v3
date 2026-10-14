import request from "supertest";
import { createApp } from "../../src/app";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCompany, createQueue, createUser } from "../helpers/factories";

const app = createApp();

describe("users API", () => {
  beforeEach(resetDb);

  async function setup() {
    const company = await createCompany();
    const admin = await createUser(company.id, { profile: "admin" });
    const queue = await createQueue(company.id);
    return { company, admin, queue };
  }

  it("lists user options of the caller's company for every profile", async () => {
    const { company, admin, queue } = await setup();
    const agent = await createUser(company.id, { name: "Agente", queueIds: [queue.id] });
    const other = await createCompany();
    await createUser(other.id, { name: "Estranho" });
    const res = await request(app).get("/api/users/options").set("Authorization", bearer(agent));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body).toEqual(
      expect.arrayContaining([
        { id: admin.id, name: admin.name, queueIds: [] },
        { id: agent.id, name: "Agente", queueIds: [queue.id] },
      ]),
    );
    expect(Object.keys(res.body[0]).sort()).toEqual(["id", "name", "queueIds"]);
    expect((await request(app).get("/api/users/options")).status).toBe(401);
  });

  it("creates an agent linked to queues and lets them log in", async () => {
    const { admin, queue } = await setup();
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", bearer(admin))
      .send({ name: "Bruno", email: "Bruno@Test.local", password: "senha123", profile: "agent", queueIds: [queue.id] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Bruno", email: "bruno@test.local", profile: "agent", queueIds: [queue.id] });
    expect(res.body.passwordHash).toBeUndefined();

    const login = await request(app).post("/api/auth/login").send({ email: "bruno@test.local", password: "senha123" });
    expect(login.status).toBe(200);
  });

  it("rejects a duplicate e-mail with 409", async () => {
    const { admin } = await setup();
    const body = { name: "A", email: "dup@test.local", password: "senha123", profile: "agent" };
    await request(app).post("/api/users").set("Authorization", bearer(admin)).send(body).expect(201);
    const res = await request(app).post("/api/users").set("Authorization", bearer(admin)).send(body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_IN_USE");
  });

  it("rejects queues from another company", async () => {
    const { admin } = await setup();
    const other = await createCompany();
    const foreignQueue = await createQueue(other.id);
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", bearer(admin))
      .send({ name: "A", email: "a@test.local", password: "senha123", profile: "agent", queueIds: [foreignQueue.id] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_QUEUE");
  });

  it("lets supervisors list but not create users", async () => {
    const { company } = await setup();
    const supervisor = await createUser(company.id, { profile: "supervisor" });
    expect((await request(app).get("/api/users").set("Authorization", bearer(supervisor))).status).toBe(200);
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", bearer(supervisor))
      .send({ name: "A", email: "a@test.local", password: "senha123", profile: "agent" });
    expect(res.status).toBe(403);
  });

  it("only lists users of the caller's company", async () => {
    const { admin } = await setup();
    const other = await createCompany();
    await createUser(other.id, { name: "Estranho" });
    const res = await request(app).get("/api/users").set("Authorization", bearer(admin));
    expect(res.body.map((u: { name: string }) => u.name)).not.toContain("Estranho");
  });

  it("updates queues and password, invalidating old refresh tokens", async () => {
    const { company, admin, queue } = await setup();
    const agent = await createUser(company.id, { email: "c@test.local", password: "antiga1" });
    const login = await request(app).post("/api/auth/login").send({ email: "c@test.local", password: "antiga1" });

    const res = await request(app)
      .put(`/api/users/${agent.id}`)
      .set("Authorization", bearer(admin))
      .send({ password: "nova123", queueIds: [queue.id] });
    expect(res.status).toBe(200);
    expect(res.body.queueIds).toEqual([queue.id]);

    const refreshed = await request(app).post("/api/auth/refresh").send({ refreshToken: login.body.refreshToken });
    expect(refreshed.status).toBe(401);
    const relogin = await request(app).post("/api/auth/login").send({ email: "c@test.local", password: "nova123" });
    expect(relogin.status).toBe(200);
  });

  it("does not let an admin delete themselves", async () => {
    const { admin } = await setup();
    const res = await request(app).delete(`/api/users/${admin.id}`).set("Authorization", bearer(admin));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CANNOT_DELETE_SELF");
  });

  it("returns 404 on PUT/DELETE of a user from another company", async () => {
    const { admin } = await setup();
    const other = await createCompany();
    const foreign = await createUser(other.id);
    const put = await request(app).put(`/api/users/${foreign.id}`).set("Authorization", bearer(admin)).send({ name: "X" });
    expect(put.status).toBe(404);
    const del = await request(app).delete(`/api/users/${foreign.id}`).set("Authorization", bearer(admin));
    expect(del.status).toBe(404);
  });

  it("deletes a user with 204", async () => {
    const { company, admin } = await setup();
    const agent = await createUser(company.id);
    await request(app).delete(`/api/users/${agent.id}`).set("Authorization", bearer(admin)).expect(204);
    const list = await request(app).get("/api/users").set("Authorization", bearer(admin));
    expect(list.body.map((u: { id: number }) => u.id)).not.toContain(agent.id);
  });

  it("rejects PUT with another user's e-mail but allows keeping its own", async () => {
    const { company, admin } = await setup();
    const a = await createUser(company.id, { email: "a1@test.local" });
    await createUser(company.id, { email: "b1@test.local" });
    const clash = await request(app).put(`/api/users/${a.id}`).set("Authorization", bearer(admin)).send({ email: "b1@test.local" });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("EMAIL_IN_USE");
    const same = await request(app).put(`/api/users/${a.id}`).set("Authorization", bearer(admin)).send({ email: "a1@test.local" });
    expect(same.status).toBe(200);
  });

  it("protects the last admin from demotion and allows it when another exists", async () => {
    const { company, admin } = await setup();
    const res = await request(app).put(`/api/users/${admin.id}`).set("Authorization", bearer(admin)).send({ profile: "agent" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LAST_ADMIN");
    const second = await createUser(company.id, { profile: "admin" });
    const ok = await request(app).put(`/api/users/${second.id}`).set("Authorization", bearer(admin)).send({ profile: "agent" });
    expect(ok.status).toBe(200);
  });
});
