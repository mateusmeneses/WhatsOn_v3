import { makeContact } from "@/test/factories";
import { updateContact } from "@/features/contacts/contactsApi";
import { rememberOnContact } from "./managerApi";

vi.mock("@/features/contacts/contactsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/contacts/contactsApi")>()),
  updateContact: vi.fn(),
}));

describe("rememberOnContact", () => {
  beforeEach(() => vi.mocked(updateContact).mockReset().mockResolvedValue(makeContact()));

  it("saves the company and product chosen in the Manager on the contact", async () => {
    await rememberOnContact(makeContact({ id: 4 }), {
      client: { id: 123, name: "HIPER" },
      product: { id: 8, name: "Sistema Fiscal" },
    });
    expect(updateContact).toHaveBeenCalledWith(4, {
      managerClientId: 123,
      clientCompany: "HIPER",
      managerProductId: 8,
      product: "Sistema Fiscal",
    });
  });

  it("does nothing when the contact already has them, and only sends what changed", async () => {
    const contact = makeContact({ id: 4, managerClientId: 123, clientCompany: "HIPER", managerProductId: 7, product: "Gestão Café" });
    await rememberOnContact(contact, { client: { id: 123, name: "HIPER" }, product: { id: 7, name: "Gestão Café" } });
    expect(updateContact).not.toHaveBeenCalled();

    await rememberOnContact(contact, { client: { id: 123, name: "HIPER" }, product: { id: 8, name: "Sistema Fiscal" } });
    expect(updateContact).toHaveBeenCalledWith(4, { managerProductId: 8, product: "Sistema Fiscal" });
  });
});
