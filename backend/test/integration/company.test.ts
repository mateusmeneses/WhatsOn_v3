import request from "supertest";
import { createApp } from "../../src/app";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCompany, createUser } from "../helpers/factories";

const app = createApp();

describe("company settings", () => {
  beforeEach(resetDb);

  it("returns the caller's company and lets admins update it", async () => {
    const company = await createCompany({ name: "Loja X" });
    const admin = await createUser(company.id, { profile: "admin" });
    const me = await request(app).get("/api/company").set("Authorization", bearer(admin));
    expect(me.body).toMatchObject({ id: company.id, name: "Loja X", timezone: "America/Sao_Paulo" });

    const res = await request(app)
      .put("/api/company")
      .set("Authorization", bearer(admin))
      .send({ name: "Loja Y", timezone: "America/Manaus" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Loja Y", timezone: "America/Manaus" });
  });

  it("lets admins set the first-response goal, within 1 to 240 minutes", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, { profile: "admin" });
    const get = await request(app).get("/api/company").set("Authorization", bearer(admin));
    expect(get.body.responseSlaMinutes).toBe(5);
    const put = (minutes: number) => request(app).put("/api/company").set("Authorization", bearer(admin)).send({ responseSlaMinutes: minutes });
    expect((await put(10)).body.responseSlaMinutes).toBe(10);
    await put(0).expect(400);
    await put(241).expect(400);
    await put(2.5).expect(400);
  });

  it("lets admins set the inactivity close time (0 turns it off) and message", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, { profile: "admin" });
    const get = await request(app).get("/api/company").set("Authorization", bearer(admin));
    expect(get.body).toMatchObject({ inactivityCloseMinutes: 0, inactivityCloseMessage: "" });
    const put = (body: object) => request(app).put("/api/company").set("Authorization", bearer(admin)).send(body);
    const saved = await put({ inactivityCloseMinutes: 60, inactivityCloseMessage: "Encerrado por inatividade." });
    expect(saved.body).toMatchObject({ inactivityCloseMinutes: 60, inactivityCloseMessage: "Encerrado por inatividade." });
    expect((await put({ inactivityCloseMinutes: 0 })).body.inactivityCloseMinutes).toBe(0);
    await put({ inactivityCloseMinutes: -1 }).expect(400);
    await put({ inactivityCloseMinutes: 10081 }).expect(400);
    await put({ inactivityCloseMessage: "x".repeat(2001) }).expect(400);
  });

  it("rejects invalid time zones and non-admin updates", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, { profile: "admin" });
    const agent = await createUser(company.id, { profile: "agent" });
    const bad = await request(app).put("/api/company").set("Authorization", bearer(admin)).send({ timezone: "Mars/Base" });
    expect(bad.status).toBe(400);
    const forbidden = await request(app).put("/api/company").set("Authorization", bearer(agent)).send({ name: "X" });
    expect(forbidden.status).toBe(403);
  });
});
