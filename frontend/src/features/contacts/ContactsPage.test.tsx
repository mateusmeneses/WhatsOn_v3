import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeContact } from "@/test/factories";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { ContactsPage } from "./ContactsPage";
import { fetchContacts, fetchContactStats, updateContact } from "./contactsApi";

vi.mock("./contactsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./contactsApi")>()),
  fetchContacts: vi.fn(),
  fetchContactStats: vi.fn(),
  updateContact: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("ContactsPage history columns", () => {
  it("shows ticket count, last contact and the active ticket status", async () => {
    setTestUser();
    vi.mocked(fetchContacts).mockResolvedValue({ items: [makeContact({ id: 7, name: "Maria Souza" })], hasMore: false });
    vi.mocked(fetchContactStats).mockResolvedValue([{ id: 7, tickets: 5, lastContactAt: new Date().toISOString(), activeStatus: "open" }]);
    renderWithProviders(<ContactsPage />);
    const row = (await screen.findByText("Maria Souza")).closest("tr")!;
    expect(await within(row).findByText("5")).toBeInTheDocument();
    expect(within(row).getByText("agora")).toBeInTheDocument();
    expect(within(row).getByText("Em atendimento")).toBeInTheDocument();
  });
});

describe("ContactsPage", () => {
  beforeEach(() => {
    setTestUser();
    vi.mocked(fetchContactStats).mockResolvedValue([]);
  });

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

    await userEvent.type(screen.getByPlaceholderText("Buscar por nome, número ou empresa"), "maria");
    await waitFor(() => expect(fetchContacts).toHaveBeenCalledWith("maria", 1));
  });

  it("renames a contact", async () => {
    vi.mocked(fetchContacts).mockResolvedValue({ items: [makeContact({ id: 1, name: "Maria" })], hasMore: false });
    vi.mocked(updateContact).mockResolvedValue(makeContact({ id: 1, name: "Maria VIP" }));
    const { queryClient } = renderWithProviders(<ContactsPage />);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await userEvent.click(await screen.findByRole("button", { name: "Editar Maria" }));
    const dialog = screen.getByRole("dialog", { name: "Editar contato" });
    const input = within(dialog).getByLabelText("Nome");
    await userEvent.clear(input);
    await userEvent.type(input, "Maria VIP");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(updateContact).toHaveBeenCalledWith(1, {
        name: "Maria VIP",
        clientCompany: null,
        managerClientId: null,
        product: null,
        managerProductId: null,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tickets"] });
  });

  it("shows and edits company and product as free text when the Manager is off", async () => {
    vi.mocked(fetchContacts).mockResolvedValue({
      items: [makeContact({ id: 1, name: "Maria", clientCompany: "Padaria Pão Quente", product: "Gestão Café" })],
      hasMore: false,
    });
    vi.mocked(updateContact).mockResolvedValue(makeContact({ id: 1 }));
    renderWithProviders(<ContactsPage />);

    const row = (await screen.findByText("Maria")).closest("tr")!;
    expect(within(row).getByText("Padaria Pão Quente")).toBeInTheDocument();
    expect(within(row).getByText("Gestão Café")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Editar Maria" }));
    const dialog = screen.getByRole("dialog", { name: "Editar contato" });
    const productInput = within(dialog).getByLabelText("Produto");
    await userEvent.clear(productInput);
    await userEvent.type(productInput, "Sistema Fiscal");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(updateContact).toHaveBeenCalledWith(1, {
        name: "Maria",
        clientCompany: "Padaria Pão Quente",
        managerClientId: null,
        product: "Sistema Fiscal",
        managerProductId: null,
      }),
    );
  });
});
