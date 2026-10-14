import { UniqueConstraintError } from "sequelize";
import { resetDb } from "../helpers/db";
import { createContact, createMessage, createTicket, createCompany, createNode, scenario } from "../helpers/factories";

describe("database constraints", () => {
  beforeEach(resetDb);

  it("allows only one non-closed ticket per contact and connection", async () => {
    const { company, connection, contact } = await scenario();
    const base = { companyId: company.id, contactId: contact.id, connectionId: connection.id };
    await createTicket({ ...base, status: "pending" });
    await expect(createTicket({ ...base, status: "bot" })).rejects.toThrow(UniqueConstraintError);
  });

  it("allows a new ticket once the previous one is closed", async () => {
    const { company, connection, contact } = await scenario();
    const base = { companyId: company.id, contactId: contact.id, connectionId: connection.id };
    await createTicket({ ...base, status: "closed" });
    await expect(createTicket({ ...base, status: "bot" })).resolves.toBeDefined();
  });

  it("rejects a duplicate providerMessageId on the same connection", async () => {
    const { company, connection, contact } = await scenario();
    const ticket = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id });
    await createMessage(ticket, { providerMessageId: "ABC" });
    await expect(createMessage(ticket, { providerMessageId: "ABC" })).rejects.toThrow(UniqueConstraintError);
    await expect(createMessage(ticket, { providerMessageId: null })).resolves.toBeDefined();
    await expect(createMessage(ticket, { providerMessageId: null })).resolves.toBeDefined();
  });

  it("keeps contact numbers unique per company only", async () => {
    const a = await createCompany();
    const b = await createCompany();
    await createContact(a.id, { number: "5511911112222" });
    await expect(createContact(a.id, { number: "5511911112222" })).rejects.toThrow(UniqueConstraintError);
    await expect(createContact(b.id, { number: "5511911112222" })).resolves.toBeDefined();
  });

  it("allows a single chatbot root per connection", async () => {
    const { connection } = await scenario();
    const root = await createNode(connection);
    await expect(createNode(connection)).rejects.toThrow(UniqueConstraintError);
    await createNode(connection, { parentId: root.id, key: "1", title: "A" });
    await expect(createNode(connection, { parentId: root.id, key: "1", title: "B" })).rejects.toThrow(
      UniqueConstraintError,
    );
  });
});
