import { Queue } from "bullmq";
import request from "supertest";
import { createApp } from "../../src/app";
import { saveBuffer } from "../../src/modules/media/media.storage";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { Message } from "../../src/models";
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
    expect(res.body).toMatchObject({ body: `*${agent.name.split(" ")[0]}:*\nBom dia!`, fromMe: true, ack: "pending", sentByUserId: agent.id });
  });

  describe("signature", () => {
    it("always signs messages of agents, even when they ask not to", async () => {
      const { agent, ticket } = await setup();
      const res = await request(app)
        .post(`/api/tickets/${ticket.id}/messages`)
        .set("Authorization", bearer(agent))
        .send({ body: "Oi", sign: false });
      expect(res.body.body).toBe(`*${agent.name.split(" ")[0]}:*\nOi`);
    });

    it("lets an admin choose to send without the signature", async () => {
      const { company, ticket } = await setup();
      const admin = await createUser(company.id, { profile: "admin", name: "Mateus Meneses" });
      const signed = await request(app)
        .post(`/api/tickets/${ticket.id}/messages`)
        .set("Authorization", bearer(admin))
        .send({ body: "Com assinatura" });
      expect(signed.body.body).toBe("*Mateus:*\nCom assinatura");
      const plain = await request(app)
        .post(`/api/tickets/${ticket.id}/messages`)
        .set("Authorization", bearer(admin))
        .send({ body: "Sem assinatura", sign: false });
      expect(plain.body.body).toBe("Sem assinatura");
    });

    it("signs media captions but not audio", async () => {
      const { agent, ticket, company } = await setup();
      const image = await saveBuffer(company.id, Buffer.from("img"), "image/png", "a.png");
      const audio = await saveBuffer(company.id, Buffer.from("aud"), "audio/ogg", "a.ogg");
      const img = await request(app).post(`/api/tickets/${ticket.id}/messages`).set("Authorization", bearer(agent)).send({ media: image });
      expect(img.body.body).toBe(`*${agent.name.split(" ")[0]}:*`);
      const aud = await request(app).post(`/api/tickets/${ticket.id}/messages`).set("Authorization", bearer(agent)).send({ media: audio });
      expect(aud.body.body).toBe("");
    });
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

  it("keeps the message failed when re-enqueue fails", async () => {
    const { agent, ticket } = await setup();
    const failed = await createMessage(ticket, { fromMe: true, ack: "failed", body: "x" });
    const spy = jest.spyOn(Queue.prototype, "add").mockRejectedValueOnce(new Error("redis down"));
    try {
      const res = await request(app).post(`/api/messages/${failed.id}/resend`).set("Authorization", bearer(agent));
      expect(res.status).toBe(200);
      expect(res.body.ack).toBe("failed");
      expect((await Message.findByPk(failed.id))?.ack).toBe("failed");
    } finally {
      spy.mockRestore();
    }
  });

  describe("edit and delete", () => {
    async function sent(ticket: Parameters<typeof createMessage>[0], attrs: Record<string, unknown> = {}) {
      return createMessage(ticket, { fromMe: true, ack: "delivered", body: "Bom dia", providerMessageId: "WA1", ...attrs });
    }

    it("edits a sent text message on WhatsApp and stores the new text", async () => {
      const { agent, ticket, contact } = await setup();
      const msg = await sent(ticket);
      const res = await request(app).patch(`/api/messages/${msg.id}`).set("Authorization", bearer(agent)).send({ body: "Boa tarde" });
      expect(res.status).toBe(200);
      expect(res.body.body).toBe("Boa tarde");
      expect(res.body.editedAt).toBeTruthy();
      expect(fake.edits).toEqual([{ number: contact.number, id: "WA1", text: "Boa tarde" }]);
      expect((await ticket.reload()).lastMessage).toBe("Boa tarde");
    });

    it("refuses to edit after 15 minutes, media, customer or unsent messages", async () => {
      const { agent, ticket } = await setup();
      const old = await sent(ticket, { providerMessageId: "WA2" });
      await Message.update({ createdAt: new Date(Date.now() - 16 * 60 * 1000) }, { where: { id: old.id }, silent: true });
      const media = await sent(ticket, { providerMessageId: "WA3", type: "image", mediaUrl: "/media/1/a.png" });
      const customer = await createMessage(ticket, { providerMessageId: "WA4" });
      const failed = await sent(ticket, { providerMessageId: null, ack: "failed" });
      const codes = [];
      for (const m of [old, media, customer, failed]) {
        const res = await request(app).patch(`/api/messages/${m.id}`).set("Authorization", bearer(agent)).send({ body: "x" });
        expect(res.status).toBe(409);
        codes.push(res.body.error.code);
      }
      expect(codes).toEqual(["EDIT_EXPIRED", "NOT_EDITABLE", "NOT_OWN_MESSAGE", "NOT_EDITABLE"]);
      expect(fake.edits).toEqual([]);
    });

    it("rejects an empty edit", async () => {
      const { agent, ticket } = await setup();
      const msg = await sent(ticket);
      const res = await request(app).patch(`/api/messages/${msg.id}`).set("Authorization", bearer(agent)).send({ body: "  " });
      expect(res.status).toBe(400);
    });

    it("deletes a sent message for everyone and keeps the row marked as deleted", async () => {
      const { agent, ticket, contact } = await setup();
      const msg = await sent(ticket, { type: "audio", body: "", mediaUrl: "/media/1/a.ogg" });
      const res = await request(app).delete(`/api/messages/${msg.id}`).set("Authorization", bearer(agent));
      expect(res.status).toBe(200);
      expect(res.body.deletedAt).toBeTruthy();
      expect(fake.deletes).toEqual([{ number: contact.number, id: "WA1" }]);
      expect((await ticket.reload()).lastMessage).toBe("🚫 Mensagem apagada");

      const again = await request(app).delete(`/api/messages/${msg.id}`).set("Authorization", bearer(agent));
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("MESSAGE_DELETED");
    });

    it("deletes a failed message locally without calling WhatsApp", async () => {
      const { agent, ticket } = await setup();
      const failed = await sent(ticket, { providerMessageId: null, ack: "failed" });
      const res = await request(app).delete(`/api/messages/${failed.id}`).set("Authorization", bearer(agent));
      expect(res.status).toBe(200);
      expect(fake.deletes).toEqual([]);
    });

    it("keeps the message when WhatsApp refuses the delete", async () => {
      const { agent, ticket } = await setup();
      const msg = await sent(ticket);
      fake.failNext("delete");
      const res = await request(app).delete(`/api/messages/${msg.id}`).set("Authorization", bearer(agent));
      expect(res.status).toBe(502);
      expect((await Message.findByPk(msg.id))?.deletedAt).toBeNull();
    });

    it("forbids another agent from changing the message", async () => {
      const { ticket, company, queue } = await setup();
      const other = await createUser(company.id, { queueIds: [queue.id] });
      const msg = await sent(ticket);
      const res = await request(app).delete(`/api/messages/${msg.id}`).set("Authorization", bearer(other));
      expect(res.status).toBe(403);
    });
  });
});
