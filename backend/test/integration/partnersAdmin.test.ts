import request from "supertest";
import { createApp } from "../../src/app";
import { Company, Partner } from "../../src/models";
import { hashPartnerKey } from "../../src/modules/partners/partnerKey";
import { bearer, superAdminBearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCompany, createPartner, createSuperAdmin, createUser } from "../helpers/factories";
import { resetRedis } from "../helpers/redis";

const app = createApp();
const KEY = /^wpk_[0-9a-f]{48}$/;

describe("super-admin: partners", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
  });

  it("creates a partner and shows the key only once", async () => {
    const sa = await createSuperAdmin();
    const res = await request(app).post("/api/admin/partners").set("Authorization", superAdminBearer(sa)).send({ name: "MultiComércio" });
    expect(res.status).toBe(201);
    const key = res.body.key as string;
    expect(key).toMatch(KEY);
    expect(res.body.partner).toMatchObject({ name: "MultiComércio", status: "active", keyPrefix: key.slice(0, 12), companyCount: 0 });
    expect(await Partner.findOne({ where: { keyHash: hashPartnerKey(key) } })).not.toBeNull();

    const list = await request(app).get("/api/admin/partners").set("Authorization", superAdminBearer(sa));
    expect(list.status).toBe(200);
    expect(list.body).toEqual([expect.objectContaining({ name: "MultiComércio", keyPrefix: key.slice(0, 12) })]);
    const raw = JSON.stringify(list.body);
    expect(raw).not.toContain(key);
    expect(raw).not.toContain("keyHash");
  });

  it("regenerates the key, renames, revokes and reactivates", async () => {
    const sa = await createSuperAdmin();
    const { partner, key } = await createPartner({ name: "ERP" });
    const auth = superAdminBearer(sa);

    const regen = await request(app).post(`/api/admin/partners/${partner.id}/regenerate-key`).set("Authorization", auth);
    expect(regen.status).toBe(200);
    expect(regen.body.key).toMatch(KEY);
    expect(regen.body.key).not.toBe(key);
    expect(regen.body.partner.keyPrefix).toBe(regen.body.key.slice(0, 12));

    const renamed = await request(app).put(`/api/admin/partners/${partner.id}`).set("Authorization", auth).send({ name: "ERP 2" });
    expect(renamed.body).toMatchObject({ name: "ERP 2" });
    expect(renamed.body.key).toBeUndefined();

    const revoked = await request(app).post(`/api/admin/partners/${partner.id}/revoke`).set("Authorization", auth);
    expect(revoked.body).toMatchObject({ status: "revoked" });
    const active = await request(app).post(`/api/admin/partners/${partner.id}/activate`).set("Authorization", auth);
    expect(active.body).toMatchObject({ status: "active" });

    const missing = await request(app).post("/api/admin/partners/999/revoke").set("Authorization", auth);
    expect(missing.status).toBe(404);
  });

  it("counts the partner's companies", async () => {
    const sa = await createSuperAdmin();
    const { partner } = await createPartner();
    await createCompany({ partnerId: partner.id });
    await createCompany({ partnerId: partner.id });
    await createCompany();
    const res = await request(app).get("/api/admin/partners").set("Authorization", superAdminBearer(sa));
    expect(res.body[0].companyCount).toBe(2);
  });

  it("forbids partners to company users", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, { profile: "admin" });
    const res = await request(app).get("/api/admin/partners").set("Authorization", bearer(admin));
    expect(res.status).toBe(403);
  });
});

describe("super-admin: company CNPJ", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
  });

  it("stores the normalized CNPJ on create and lists it with the partner", async () => {
    const sa = await createSuperAdmin();
    const res = await request(app)
      .post("/api/admin/companies")
      .set("Authorization", superAdminBearer(sa))
      .send({ name: "Loja", cnpj: "12.345.678/0001-95", admin: { name: "Ana", email: "ana@loja.com" } });
    expect(res.status).toBe(201);
    expect(res.body.company).toMatchObject({ cnpj: "12345678000195", partner: null });

    const { partner } = await createPartner({ name: "ERP" });
    await createCompany({ name: "Zeta", partnerId: partner.id, cnpj: "12ABC34501DE35" });
    const list = await request(app).get("/api/admin/companies").set("Authorization", superAdminBearer(sa));
    expect(list.body).toEqual([
      expect.objectContaining({ name: "Loja", cnpj: "12345678000195", partner: null }),
      expect.objectContaining({ name: "Zeta", cnpj: "12ABC34501DE35", partner: { id: partner.id, name: "ERP" } }),
    ]);
  });

  it("rejects a duplicated or invalid CNPJ", async () => {
    const sa = await createSuperAdmin();
    await createCompany({ cnpj: "12345678000195" });
    const dup = await request(app)
      .post("/api/admin/companies")
      .set("Authorization", superAdminBearer(sa))
      .send({ name: "X", cnpj: "12345678000195", admin: { name: "A", email: "a@x.com" } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("CNPJ_IN_USE");
    expect(await Company.count()).toBe(1);

    const bad = await request(app)
      .post("/api/admin/companies")
      .set("Authorization", superAdminBearer(sa))
      .send({ name: "X", cnpj: "12345678000196", admin: { name: "A", email: "a@x.com" } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_CNPJ");
  });

  it("sets, keeps and clears the CNPJ on update", async () => {
    const sa = await createSuperAdmin();
    const company = await createCompany();
    const other = await createCompany({ cnpj: "12ABC34501DE35" });
    const put = (body: object) =>
      request(app).put(`/api/admin/companies/${company.id}`).set("Authorization", superAdminBearer(sa)).send(body);

    expect((await put({ cnpj: "12345678000195" })).body.cnpj).toBe("12345678000195");
    expect((await put({ name: "Só nome" })).body.cnpj).toBe("12345678000195");
    const dup = await put({ cnpj: other.cnpj });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("CNPJ_IN_USE");
    expect((await put({ cnpj: "" })).body.cnpj).toBeNull();
  });
});
