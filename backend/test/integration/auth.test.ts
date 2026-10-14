import "express-async-errors";
import express from "express";
import request from "supertest";
import { createApp } from "../../src/app";
import { isAuth, requireProfile } from "../../src/modules/auth/auth.middleware";
import { errorHandler } from "../../src/shared/errors/errorHandler";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCompany, createUser } from "../helpers/factories";

const app = createApp();

async function setup() {
  const company = await createCompany();
  const user = await createUser(company.id, { email: "ana@test.local", password: "senha123", profile: "admin" });
  return { company, user };
}

describe("auth", () => {
  beforeEach(resetDb);

  it("logs in with valid credentials, ignoring e-mail case", async () => {
    await setup();
    const res = await request(app).post("/api/auth/login").send({ email: "ANA@test.local", password: "senha123" });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: "ana@test.local", profile: "admin" });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("rejects a wrong password", async () => {
    await setup();
    const res = await request(app).post("/api/auth/login").send({ email: "ana@test.local", password: "errada" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns the current user on /me and 401 without a token", async () => {
    const { user } = await setup();
    const ok = await request(app).get("/api/auth/me").set("Authorization", bearer(user));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: user.id, email: "ana@test.local" });

    const missing = await request(app).get("/api/auth/me");
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe("UNAUTHENTICATED");

    const garbage = await request(app).get("/api/auth/me").set("Authorization", "Bearer xyz");
    expect(garbage.status).toBe(401);
  });

  it("refreshes tokens and invalidates them on logout", async () => {
    await setup();
    const login = await request(app).post("/api/auth/login").send({ email: "ana@test.local", password: "senha123" });
    const refreshed = await request(app).post("/api/auth/refresh").send({ refreshToken: login.body.refreshToken });
    expect(refreshed.status).toBe(200);

    await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${refreshed.body.accessToken}`)
      .expect(204);

    const again = await request(app).post("/api/auth/refresh").send({ refreshToken: refreshed.body.refreshToken });
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe("INVALID_REFRESH");
  });

  it("does not accept an access token as refresh token", async () => {
    const { user } = await setup();
    const res = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: bearer(user).slice("Bearer ".length) });
    expect(res.status).toBe(401);
  });

  it("blocks profiles not allowed by requireProfile", async () => {
    const company = await createCompany();
    const agent = await createUser(company.id, { profile: "agent" });
    const admin = await createUser(company.id, { profile: "admin" });
    const mini = express();
    mini.get("/admin-only", isAuth, requireProfile("admin"), (_req, res) => {
      res.json({ ok: true });
    });
    mini.use(errorHandler);

    expect((await request(mini).get("/admin-only").set("Authorization", bearer(agent))).status).toBe(403);
    expect((await request(mini).get("/admin-only").set("Authorization", bearer(admin))).status).toBe(200);
  });
});
