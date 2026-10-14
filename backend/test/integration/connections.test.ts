import request from "supertest";
import { createApp } from "../../src/app";
import { Connection } from "../../src/models";
import {
  applyConnectionUpdate,
  checkConnectionsHealth,
} from "../../src/modules/connections/connections.service";
import { emitter } from "../../src/modules/realtime/socket";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCompany, createConnection, createTicket, createUser, scenario } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";

const app = createApp();
const fake = new FakeProvider();

async function admin() {
  const company = await createCompany();
  const user = await createUser(company.id, { profile: "admin" });
  return { company, user };
}

describe("connections", () => {
  beforeEach(async () => {
    await resetDb();
    fake.reset();
    setProvider(fake);
  });
  afterAll(() => setProvider(null));

  it("creates a connection, registers the instance and hides the webhook token", async () => {
    const { user } = await admin();
    const res = await request(app).post("/api/connections").set("Authorization", bearer(user)).send({ name: "Comercial" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Comercial", status: "qrcode", isDefault: true });
    expect(res.body.webhookToken).toBeUndefined();

    const saved = await Connection.findByPk(res.body.id);
    expect(fake.instances.get(saved!.instanceName)).toBe(`http://backend.test/webhooks/evolution/${saved!.webhookToken}`);
  });

  it("rolls back when the provider fails", async () => {
    const { user } = await admin();
    fake.failNext("createInstance");
    const res = await request(app).post("/api/connections").set("Authorization", bearer(user)).send({ name: "X" });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("PROVIDER_ERROR");
    expect(await Connection.count()).toBe(0);
  });

  it("keeps a single default connection per company", async () => {
    const { user } = await admin();
    const first = await request(app).post("/api/connections").set("Authorization", bearer(user)).send({ name: "A" });
    const second = await request(app)
      .post("/api/connections")
      .set("Authorization", bearer(user))
      .send({ name: "B", isDefault: true });
    expect(second.body.isDefault).toBe(true);
    expect((await Connection.findByPk(first.body.id))!.isDefault).toBe(false);
  });

  it("refuses to delete a connection that has tickets", async () => {
    const { company, connection, contact } = await scenario();
    const user = await createUser(company.id, { profile: "admin" });
    await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id });
    const res = await request(app).delete(`/api/connections/${connection.id}`).set("Authorization", bearer(user));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONNECTION_HAS_TICKETS");
  });

  it("deletes the instance at the provider", async () => {
    const { company, user } = await admin();
    const connection = await createConnection(company.id);
    fake.instances.set(connection.instanceName, "x");
    await request(app).delete(`/api/connections/${connection.id}`).set("Authorization", bearer(user)).expect(204);
    expect(fake.instances.has(connection.instanceName)).toBe(false);
    expect(await Connection.count()).toBe(0);
  });

  it("returns a QR code for a disconnected connection", async () => {
    const { company, user } = await admin();
    const connection = await createConnection(company.id, { status: "disconnected" });
    const res = await request(app).get(`/api/connections/${connection.id}/qrcode`).set("Authorization", bearer(user));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ qr: "data:image/png;base64,FAKEQR" });
    expect((await Connection.findByPk(connection.id))!.status).toBe("qrcode");
  });

  it("lets agents list connections but not create them", async () => {
    const { company } = await admin();
    const agent = await createUser(company.id, { profile: "agent" });
    await createConnection(company.id);
    const list = await request(app).get("/api/connections").set("Authorization", bearer(agent));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].webhookToken).toBeUndefined();
    const res = await request(app).post("/api/connections").set("Authorization", bearer(agent)).send({ name: "X" });
    expect(res.status).toBe(403);
  });

  it("emits an alert when a connected instance drops", async () => {
    const { company } = await admin();
    const connection = await createConnection(company.id, { status: "connected" });
    const spy = jest.spyOn(emitter, "toSupervisors");
    await applyConnectionUpdate(connection, "disconnected");
    expect(spy).toHaveBeenCalledWith(company.id, "connection:alert", { connectionId: connection.id, name: connection.name });
    expect((await Connection.findByPk(connection.id))!.status).toBe("disconnected");
    spy.mockRestore();
  });

  it("health check fixes divergent statuses", async () => {
    const { company } = await admin();
    const connection = await createConnection(company.id, { status: "connected" });
    fake.state = "disconnected";
    await checkConnectionsHealth();
    expect((await Connection.findByPk(connection.id))!.status).toBe("disconnected");
  });
});
