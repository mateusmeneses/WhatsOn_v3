import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeContact } from "@/test/factories";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { ContactsPage } from "./ContactsPage";
import { fetchContacts, updateContact } from "./contactsApi";

vi.mock("./contactsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./contactsApi")>()),
  fetchContacts: vi.fn(),
  updateContact: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("ContactsPage", () => {
  beforeEach(() => setTestUser());

  it("lists, searches and paginates contacts", async () => {
    vi.mocked(fetchContacts).mockImplementation(async (_search, page) =>
      page === 1
        ? { items: [makeContact({ id: 1, name: "Maria Souza" })], hasMore: true }
        : { items: [makeContact({ id: 2, name: "João Lima" })], hasMore: false },
    );
    renderWithProviders(<ContactsPage />);

    expect(await screen.findByText("Maria Souza")).toBeInTheDocument();
    expect(screen.getByText("+55 (11) 98888-7777")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(await screen.findByText("João Lima")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Próxima" })).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText("Buscar por nome ou número"), "maria");
    await waitFor(() => expect(fetchContacts).toHaveBeenCalledWith("maria", 1));
  });

  it("renames a contact", async () => {
    vi.mocked(fetchContacts).mockResolvedValue({ items: [makeContact({ id: 1, name: "Maria" })], hasMore: false });
    vi.mocked(updateContact).mockResolvedValue(makeContact({ id: 1, name: "Maria VIP" }));
    renderWithProviders(<ContactsPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Editar Maria" }));
    const dialog = screen.getByRole("dialog", { name: "Editar contato" });
    const input = within(dialog).getByLabelText("Nome");
    await userEvent.clear(input);
    await userEvent.type(input, "Maria VIP");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(updateContact).toHaveBeenCalledWith(1, { name: "Maria VIP" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
