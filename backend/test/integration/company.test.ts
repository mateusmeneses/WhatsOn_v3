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
