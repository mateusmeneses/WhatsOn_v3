import request from "supertest";
import { createApp } from "../../src/app";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCompany, createContact, createQueue, createTicket, createUser, scenario } from "../helpers/factories";

const app = createApp();

describe("queues API", () => {
  beforeEach(resetDb);

  it("lets admins create, update and delete queues", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, { profile: "admin" });

    const created = await request(app)
      .post("/api/queues")
      .set("Authorization", bearer(admin))
      .send({ name: "Financeiro", color: "#ff0000", schedule: { "1": ["08:00-18:00"] } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Financeiro", color: "#ff0000", companyId: company.id });

    const updated = await request(app)
      .put(`/api/queues/${created.body.id}`)
      .set("Authorization", bearer(admin))
      .send({ name: "Cobrança" });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("Cobrança");

    await request(app).delete(`/api/queues/${created.body.id}`).set("Authorization", bearer(admin)).expect(204);
    const list = await request(app).get("/api/queues").set("Authorization", bearer(admin));
    expect(list.body).toEqual([]);
  });

  it("forbids agents from creating queues", async () => {
    const company = await createCompany();
    const agent = await createUser(company.id, { profile: "agent" });
    const res = await request(app).post("/api/queues").set("Authorization", bearer(agent)).send({ name: "X" });
    expect(res.status).toBe(403);
  });

  it("accepts 24:00 as a range end", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, { profile: "admin" });
    const res = await request(app)
      .post("/api/queues")
      .set("Authorization", bearer(admin))
      .send({ name: "Noturno", schedule: { "1": ["18:00-24:00"] } });
    expect(res.status).toBe(201);
    expect(res.body.schedule).toEqual({ "1": ["18:00-24:00"] });
  });

  it("rejects malformed or inverted schedule ranges", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, { profile: "admin" });
    for (const schedule of [
      { "1": ["8h-12h"] },
      { "1": ["12:00-08:00"] },
      { "9": ["08:00-12:00"] },
      { "1": ["24:00-24:00"] },
      { "1": ["18:00-24:30"] },
    ]) {
      const res = await request(app)
        .post("/api/queues")
        .set("Authorization", bearer(admin))
        .send({ name: "X", schedule });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("never exposes or changes queues of another company", async () => {
    const mine = await createCompany();
    const other = await createCompany();
    const admin = await createUser(mine.id, { profile: "admin" });
    const foreign = await createQueue(other.id, { name: "Deles" });

    const list = await request(app).get("/api/queues").set("Authorization", bearer(admin));
    expect(list.body).toEqual([]);

    const res = await request(app)
      .put(`/api/queues/${foreign.id}`)
      .set("Authorization", bearer(admin))
      .send({ name: "Hack" });
    expect(res.status).toBe(404);
  });
});

describe("queue stats", () => {
  beforeEach(resetDb);

  it("reports members, waiting and in-progress tickets and whether the queue is open now", async () => {
    const { company, connection, contact, queue } = await scenario();
    const closedQueue = await createQueue(company.id, { name: "Noturna", schedule: { "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] } });
    const admin = await createUser(company.id, { profile: "admin" });
    await createUser(company.id, { queueIds: [queue.id] });
    await createUser(company.id, { queueIds: [queue.id, closedQueue.id] });
    await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, queueId: queue.id, status: "pending" });
    const other = await createContact(company.id);
    await createTicket({ companyId: company.id, contactId: other.id, connectionId: connection.id, queueId: queue.id, status: "open" });

    const res = await request(app).get("/api/queues/stats").set("Authorization", bearer(admin)).expect(200);
    expect(res.body.find((q: { id: number }) => q.id === queue.id)).toEqual({ id: queue.id, members: 2, pending: 1, open: 1, openNow: true });
    expect(res.body.find((q: { id: number }) => q.id === closedQueue.id)).toMatchObject({ members: 1, pending: 0, openNow: false });

    const agent = await createUser(company.id);
    await request(app).get("/api/queues/stats").set("Authorization", bearer(agent)).expect(403);
  });
});
