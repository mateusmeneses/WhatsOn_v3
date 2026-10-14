import request from "supertest";
import { createApp } from "../../src/app";
import { saveBuffer } from "../../src/modules/media/media.storage";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createMessage, createTicket, createUser, scenario } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";
import { resetRedis } from "../helpers/redis";

const app = createApp();
const fake = new FakeProvider();

async function setup(status: "open" | "pending" = "open") {
  const s = await scenario();
  const agent = await createUser(s.company.id, { queueIds: [s.queue.id] });
  const ticket = await createTicket({
    companyId: s.company.id,
    contactId: s.contact.id,
    connectionId: s.connection.id,
    queueId: s.queue.id,
    status,
    userId: status === "open" ? agent.id : null,
  });
  return { ...s, agent, ticket };
}

describe("agent messages", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    fake.reset();
    setProvider(fake);
  });
  afterAll(() => setProvider(null));

  it("pages messages oldest-first with a before cursor", async () => {
    const { agent, ticket } = await setup();
    const created = [];
    for (let i = 0; i < 5; i++) created.push(await createMessage(ticket, { body: `m${i}` }));

    const last = await request(app).get(`/api/tickets/${ticket.id}/messages?limit=2`).set("Authorization", bearer(agent));
    expect(last.body.items.map((m: { body: string }) => m.body)).toEqual(["m3", "m4"]);
    expect(last.body.hasMore).toBe(true);

    const older = await request(app)
      .get(`/api/tickets/${ticket.id}/messages?limit=2&before=${created[3].id}`)
      .set("Authorization", bearer(agent));
    expect(older.body.items.map((m: { body: string }) => m.body)).toEqual(["m1", "m2"]);
  });

  it("sends a text message on an open ticket", async () => {
    const { agent, ticket } = await setup();
    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/messages`)
      .set("Authorization", bearer(agent))
      .send({ body: "Bom dia!" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ body: "Bom dia!", fromMe: true, ack: "pending", sentByUserId: agent.id });
  });

  it("requires the ticket to be accepted before replying", async () => {
    const { agent, ticket } = await setup("pending");
    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/messages`)
      .set("Authorization", bearer(agent))
      .send({ body: "oi" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TICKET_NOT_OPEN");
  });

  it("sends uploaded media but refuses media of another company", async () => {
    const { agent, ticket, company } = await setup();
    const mine = await saveBuffer(company.id, Buffer.from("img"), "image/png", "a.png");
    const ok = await request(app)
      .post(`/api/tickets/${ticket.id}/messages`)
      .set("Authorization", bearer(agent))
      .send({ media: mine });
    expect(ok.status).toBe(201);
    expect(ok.body.type).toBe("image");

    const foreign = await saveBuffer(company.id + 1000, Buffer.from("img"), "image/png", "b.png");
    const bad = await request(app)
      .post(`/api/tickets/${ticket.id}/messages`)
      .set("Authorization", bearer(agent))
      .send({ media: foreign });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_MEDIA");
  });

  it("rejects an empty message", async () => {
    const { agent, ticket } = await setup();
    const res = await request(app).post(`/api/tickets/${ticket.id}/messages`).set("Authorization", bearer(agent)).send({});
    expect(res.status).toBe(400);
  });

  it("resends only failed messages", async () => {
    const { agent, ticket } = await setup();
    const failed = await createMessage(ticket, { fromMe: true, ack: "failed", body: "x" });
    const ok = await request(app).post(`/api/messages/${failed.id}/resend`).set("Authorization", bearer(agent));
    expect(ok.status).toBe(200);
    expect(ok.body.ack).toBe("pending");

    const again = await request(app).post(`/api/messages/${failed.id}/resend`).set("Authorization", bearer(agent));
    expect(again.status).toBe(409);
  });
});
