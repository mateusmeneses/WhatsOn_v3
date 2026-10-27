import request from "supertest";
import { createApp } from "../../src/app";
import { Contact } from "../../src/models";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { emitter } from "../../src/modules/realtime/socket";
import { createCompany, createConnection, createContact, createMessage, createTicket, createUser } from "../helpers/factories";

const app = createApp();

describe("contacts API", () => {
  beforeEach(resetDb);

  it("lists and searches by name or number", async () => {
    const company = await createCompany();
    const agent = await createUser(company.id);
    await createContact(company.id, { name: "Maria Souza", number: "5511988887777" });
    await createContact(company.id, { name: "João Lima", number: "5521977776666" });

    const all = await request(app).get("/api/contacts").set("Authorization", bearer(agent));
    expect(all.body.items).toHaveLength(2);
    expect(all.body.hasMore).toBe(false);

    const byName = await request(app).get("/api/contacts?search=maria").set("Authorization", bearer(agent));
    expect(byName.body.items.map((c: { name: string }) => c.name)).toEqual(["Maria Souza"]);

    const byNumber = await request(app).get("/api/contacts?search=219777").set("Authorization", bearer(agent));
    expect(byNumber.body.items.map((c: { name: string }) => c.name)).toEqual(["João Lima"]);
  });

  it("renames a contact", async () => {
    const company = await createCompany();
    const agent = await createUser(company.id);
    const contact = await createContact(company.id);
    const res = await request(app)
      .put(`/api/contacts/${contact.id}`)
      .set("Authorization", bearer(agent))
      .send({ name: "Cliente VIP" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Cliente VIP");
  });

  it("soft deletes a contact: hidden from the list and from GET, row kept", async () => {
    const company = await createCompany();
    const agent = await createUser(company.id);
    const contact = await createContact(company.id, { name: "Número inválido", number: "134703227076781" });
    await createContact(company.id, { name: "Maria", number: "5511988887777" });

    const del = await request(app).delete(`/api/contacts/${contact.id}`).set("Authorization", bearer(agent));
    expect(del.status).toBe(204);

    const list = await request(app).get("/api/contacts").set("Authorization", bearer(agent));
    expect(list.body.items.map((c: { name: string }) => c.name)).toEqual(["Maria"]);
    const one = await request(app).get(`/api/contacts/${contact.id}`).set("Authorization", bearer(agent));
    expect(one.status).toBe(404);

    const row = await Contact.findByPk(contact.id);
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });

  it("hides contacts of other companies", async () => {
    const company = await createCompany();
    const other = await createCompany();
    const agent = await createUser(company.id);
    const foreign = await createContact(other.id);
    const res = await request(app).get(`/api/contacts/${foreign.id}`).set("Authorization", bearer(agent));
    expect(res.status).toBe(404);
  });

  it("pushes the new name to the contact's active tickets", async () => {
    const company = await createCompany();
    const agent = await createUser(company.id);
    const connection = await createConnection(company.id);
    const contact = await createContact(company.id);
    const open = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, status: "open" });
    await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, status: "closed" });
    const spy = jest.spyOn(emitter, "toRooms");

    await request(app).put(`/api/contacts/${contact.id}`).set("Authorization", bearer(agent)).send({ name: "Cliente VIP" });

    const updates = spy.mock.calls.filter(([, event]) => event === "ticket:update");
    expect(updates).toHaveLength(1);
    expect(updates[0][2]).toMatchObject({ id: open.id, contact: { name: "Cliente VIP" } });
    spy.mockRestore();
  });
});

describe("contact company and product", () => {
  beforeEach(resetDb);

  it("saves company and product (with Manager codes) without touching the name, and clears with empty text", async () => {
    const company = await createCompany();
    const agent = await createUser(company.id);
    const contact = await createContact(company.id, { name: "Maria" });

    const res = await request(app)
      .put(`/api/contacts/${contact.id}`)
      .set("Authorization", bearer(agent))
      .send({ clientCompany: "Padaria Pão Quente", managerClientId: 321, product: "Gestão Café", managerProductId: 7 })
      .expect(200);
    expect(res.body).toMatchObject({
      name: "Maria", clientCompany: "Padaria Pão Quente", managerClientId: 321, product: "Gestão Café", managerProductId: 7,
    });

    const cleared = await request(app)
      .put(`/api/contacts/${contact.id}`)
      .set("Authorization", bearer(agent))
      .send({ product: "", managerProductId: null })
      .expect(200);
    expect(cleared.body).toMatchObject({ clientCompany: "Padaria Pão Quente", product: null, managerProductId: null });
  });

  it("finds contacts by company", async () => {
    const company = await createCompany();
    const agent = await createUser(company.id);
    await createContact(company.id, { name: "Maria", clientCompany: "Padaria Pão Quente" });
    await createContact(company.id, { name: "João" });
    const res = await request(app).get("/api/contacts?search=padaria").set("Authorization", bearer(agent));
    expect(res.body.items.map((c: { name: string }) => c.name)).toEqual(["Maria"]);
  });
});

describe("contact stats", () => {
  beforeEach(resetDb);

  it("summarizes tickets, last contact and the active ticket of the requested contacts", async () => {
    const company = await createCompany();
    const agent = await createUser(company.id);
    const connection = await createConnection(company.id);
    const busy = await createContact(company.id);
    const quiet = await createContact(company.id);
    const foreign = await createContact((await createCompany()).id);
    const old = await createTicket({ companyId: company.id, contactId: busy.id, connectionId: connection.id, status: "closed" });
    await createMessage(old, { createdAt: new Date("2026-10-01T10:00:00Z") });
    const current = await createTicket({ companyId: company.id, contactId: busy.id, connectionId: connection.id, status: "open" });
    await createMessage(current, { createdAt: new Date("2026-10-10T10:00:00Z") });

    const res = await request(app)
      .get(`/api/contacts/stats?ids=${busy.id},${quiet.id},${foreign.id},abc`)
      .set("Authorization", bearer(agent))
      .expect(200);
    expect(res.body).toHaveLength(2); // o contato de outra empresa não aparece
    expect(res.body.find((c: { id: number }) => c.id === busy.id)).toEqual({
      id: busy.id, tickets: 2, lastContactAt: "2026-10-10T10:00:00.000Z", activeStatus: "open",
    });
    expect(res.body.find((c: { id: number }) => c.id === quiet.id)).toEqual({ id: quiet.id, tickets: 0, lastContactAt: null, activeStatus: null });
    await request(app).get("/api/contacts/stats").set("Authorization", bearer(agent)).expect(200, []);
  });
});
