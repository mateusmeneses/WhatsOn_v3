import request from "supertest";
import { createApp } from "../../src/app";
import { Ticket, TicketLog } from "../../src/models";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCompany, createConnection, createContact, createQueue, createTicket, createUser } from "../helpers/factories";

const app = createApp();

describe("POST /api/contacts/:id/conversation", () => {
  beforeEach(resetDb);

  it("creates an open ticket with the requester on the company's only connection", async () => {
    const company = await createCompany();
    const queue = await createQueue(company.id);
    const connection = await createConnection(company.id, { defaultQueueId: queue.id });
    const agent = await createUser(company.id);
    const contact = await createContact(company.id);

    const res = await request(app).post(`/api/contacts/${contact.id}/conversation`).set("Authorization", bearer(agent)).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ contactId: contact.id, connectionId: connection.id, status: "open", userId: agent.id, queueId: queue.id });
    const logs = await TicketLog.findAll({ where: { ticketId: res.body.id } });
    expect(logs.map((l) => l.event)).toEqual(["created"]);
  });

  it("reuses the active ticket instead of creating another", async () => {
    const company = await createCompany();
    const connection = await createConnection(company.id);
    const agent = await createUser(company.id);
    const contact = await createContact(company.id);
    const active = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, status: "pending" });

    const res = await request(app).post(`/api/contacts/${contact.id}/conversation`).set("Authorization", bearer(agent)).send({});
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(active.id);
    expect(await Ticket.count()).toBe(1);
  });

  it("refuses when the active ticket is with a colleague the agent can't see", async () => {
    const company = await createCompany();
    const connection = await createConnection(company.id);
    const agent = await createUser(company.id, { canViewOthersOpen: false });
    const colleague = await createUser(company.id, { name: "Yure" });
    const contact = await createContact(company.id);
    await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, status: "open", userId: colleague.id });

    const res = await request(app).post(`/api/contacts/${contact.id}/conversation`).set("Authorization", bearer(agent)).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain("Yure");
  });

  it("uses the connection of the contact's last ticket; asks for one when there is no history and several exist", async () => {
    const company = await createCompany();
    await createConnection(company.id);
    const second = await createConnection(company.id);
    const agent = await createUser(company.id);
    const fresh = await createContact(company.id);
    const known = await createContact(company.id);
    await createTicket({ companyId: company.id, contactId: known.id, connectionId: second.id, status: "closed", closedAt: new Date() });

    const ask = await request(app).post(`/api/contacts/${fresh.id}/conversation`).set("Authorization", bearer(agent)).send({});
    expect(ask.status).toBe(400);
    expect(ask.body.error.code).toBe("CONNECTION_REQUIRED");

    const chosen = await request(app)
      .post(`/api/contacts/${fresh.id}/conversation`)
      .set("Authorization", bearer(agent))
      .send({ connectionId: second.id });
    expect(chosen.body.connectionId).toBe(second.id);

    const reused = await request(app).post(`/api/contacts/${known.id}/conversation`).set("Authorization", bearer(agent)).send({});
    expect(reused.status).toBe(200);
    expect(reused.body).toMatchObject({ connectionId: second.id, status: "open" });
    expect(await Ticket.count({ where: { contactId: known.id } })).toBe(2);
  });

  it("isolates companies", async () => {
    const company = await createCompany();
    const other = await createCompany();
    await createConnection(company.id);
    const foreignConnection = await createConnection(other.id);
    const agent = await createUser(company.id);
    const foreignContact = await createContact(other.id);
    const contact = await createContact(company.id);

    await request(app).post(`/api/contacts/${foreignContact.id}/conversation`).set("Authorization", bearer(agent)).send({}).expect(404);
    await request(app)
      .post(`/api/contacts/${contact.id}/conversation`)
      .set("Authorization", bearer(agent))
      .send({ connectionId: foreignConnection.id })
      .expect(404);
  });
});
