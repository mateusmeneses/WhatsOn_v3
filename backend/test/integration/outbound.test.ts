import { Job, Queue } from "bullmq";
import { env } from "../../src/config/env";
import { Message } from "../../src/models";
import { saveBuffer } from "../../src/modules/media/media.storage";
import { applyAck, createOutgoingMessage } from "../../src/modules/messages/messages.service";
import { OutboundJob, processOutboundJob } from "../../src/modules/messages/outbound";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { getQueue, QueueNames, shardFor } from "../../src/queues";
import { resetDb } from "../helpers/db";
import { createMessage, createTicket, scenario } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";
import { resetRedis } from "../helpers/redis";

const fake = new FakeProvider();
const job = (messageId: number, attemptsMade = 0) =>
  ({ data: { messageId }, attemptsMade, opts: { attempts: 5 } }) as unknown as Job<OutboundJob>;

async function openTicket() {
  const s = await scenario();
  const ticket = await createTicket({ companyId: s.company.id, contactId: s.contact.id, connectionId: s.connection.id, status: "open" });
  return { ...s, ticket };
}

describe("outgoing messages", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    fake.reset();
    setProvider(fake);
  });
  afterAll(() => setProvider(null));

  it("creates a pending message, updates the ticket and enqueues it on the ticket shard", async () => {
    const { ticket } = await openTicket();
    const message = await createOutgoingMessage(ticket, { body: "Olá!" });
    expect(message).toMatchObject({ ack: "pending", fromMe: true, type: "text", providerMessageId: null });
    await ticket.reload();
    expect(ticket.lastMessage).toBe("Olá!");
    const queue = getQueue(QueueNames.outbound(shardFor(String(ticket.id), env.OUTBOUND_SHARDS)));
    const jobs = await queue.getJobs(["waiting"]);
    expect(jobs.map((j) => j.data.messageId)).toContain(message.id);
  });

  it("sends text through the provider and stores the provider id", async () => {
    const { ticket, contact, connection } = await openTicket();
    const message = await createOutgoingMessage(ticket, { body: "Olá!" });
    await processOutboundJob(job(message.id));
    expect(fake.sent).toEqual([{ instanceName: connection.instanceName, number: contact.number, text: "Olá!", quoted: undefined }]);
    await message.reload();
    expect(message).toMatchObject({ ack: "sent", providerMessageId: "fake-1" });
  });

  it("passes the quoted provider id", async () => {
    const { ticket } = await openTicket();
    const original = await createMessage(ticket, { providerMessageId: "ORIG" });
    const reply = await createOutgoingMessage(ticket, { body: "sim", quotedMessageId: original.id });
    await processOutboundJob(job(reply.id));
    expect(fake.sent[0].quoted).toBe("ORIG");
  });

  it("sends media as base64 read from storage", async () => {
    const { ticket, company } = await openTicket();
    const stored = await saveBuffer(company.id, Buffer.from("PDF"), "application/pdf", "a.pdf");
    const message = await createOutgoingMessage(ticket, { body: "segue", media: stored });
    expect(message.type).toBe("document");
    await processOutboundJob(job(message.id));
    expect(fake.sent[0].media).toEqual({
      type: "document",
      base64: Buffer.from("PDF").toString("base64"),
      mimetype: "application/pdf",
      fileName: "a.pdf",
      caption: "segue",
    });
  });

  it("keeps the message pending and rethrows on a non-final failure", async () => {
    const { ticket } = await openTicket();
    const message = await createOutgoingMessage(ticket, { body: "x" });
    fake.failNext("send");
    await expect(processOutboundJob(job(message.id, 0))).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect((await message.reload()).ack).toBe("pending");
  });

  it("marks the message failed on the final attempt", async () => {
    const { ticket } = await openTicket();
    const message = await createOutgoingMessage(ticket, { body: "x" });
    fake.failNext("send");
    await expect(processOutboundJob(job(message.id, 4))).rejects.toBeDefined();
    expect((await message.reload()).ack).toBe("failed");
  });

  it("does not resend a message that already has a provider id", async () => {
    const { ticket } = await openTicket();
    const message = await createOutgoingMessage(ticket, { body: "x" });
    await processOutboundJob(job(message.id));
    await processOutboundJob(job(message.id));
    expect(fake.sent).toHaveLength(1);
  });

  it("replaces an echo stored before the provider id was saved", async () => {
    const { ticket } = await openTicket();
    const message = await createOutgoingMessage(ticket, { body: "Olá" });
    const echo = await createMessage(ticket, { fromMe: true, body: "Olá", providerMessageId: "fake-1", ack: "sent" });
    await processOutboundJob(job(message.id));
    expect(await Message.findByPk(echo.id)).toBeNull();
    expect((await message.reload()).providerMessageId).toBe("fake-1");
  });

  it("applies acks only forward", async () => {
    const { ticket, connection } = await openTicket();
    const message = await createMessage(ticket, { fromMe: true, providerMessageId: "P1", ack: "sent" });
    await applyAck(connection.id, "P1", "read");
    expect((await message.reload()).ack).toBe("read");
    await applyAck(connection.id, "P1", "delivered");
    expect((await message.reload()).ack).toBe("read");
    await applyAck(connection.id, "UNKNOWN", "read");
  });

  it("does not throw nor resend when persisting after a successful send fails", async () => {
    const { ticket } = await openTicket();
    const message = await createOutgoingMessage(ticket, { body: "x" });
    const original = Message.update.bind(Message) as (...a: unknown[]) => Promise<unknown>;
    let failures = 0;
    const spy = jest.spyOn(Message, "update").mockImplementation(((values: Record<string, unknown>, opts: unknown) => {
      if (values.providerMessageId && failures < 3) {
        failures++;
        return Promise.reject(new Error("db down"));
      }
      return original(values, opts);
    }) as never);
    try {
      await expect(processOutboundJob(job(message.id))).resolves.toBeUndefined();
      expect(fake.sent).toHaveLength(1);
      expect(failures).toBe(3);
    } finally {
      spy.mockRestore();
    }
  });

  it("marks the message failed when enqueueing fails", async () => {
    const { ticket } = await openTicket();
    const spy = jest.spyOn(Queue.prototype, "add").mockRejectedValueOnce(new Error("redis down"));
    try {
      const message = await createOutgoingMessage(ticket, { body: "x" });
      expect((await message.reload()).ack).toBe("failed");
      expect((await Message.findByPk(message.id))!.ack).toBe("failed");
    } finally {
      spy.mockRestore();
    }
  });
});
