import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeContact } from "@/test/factories";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { fetchManagerCatalog, fetchManagerClients, useManagerEnabled } from "@/features/manager/managerApi";
import { updateContact } from "./contactsApi";
import { EditContactDialog } from "./EditContactDialog";

vi.mock("./contactsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./contactsApi")>()),
  updateContact: vi.fn(),
}));
vi.mock("@/features/manager/managerApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/manager/managerApi")>()),
  useManagerEnabled: vi.fn(),
  fetchManagerClients: vi.fn(),
  fetchManagerCatalog: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const catalog = {
  usuarios: [],
  produtos: [
    { cod_produto: 7, descricao: "Gestão Café" },
    { cod_produto: 8, descricao: "Sistema Fiscal" },
  ],
  tipos_atendimento: [],
  colunas: [],
  prioridades_os: [],
  prioridades_atendimento: [],
};
const hiper = { cod_cliente: 123, nome: "HIPER", fantasia: "Hiper Mercado", cnpj: null, contato: null };

describe("EditContactDialog with the Manager", () => {
  beforeEach(() => {
    setTestUser();
    vi.mocked(useManagerEnabled).mockReturnValue(true);
    vi.mocked(fetchManagerCatalog).mockResolvedValue(catalog);
    vi.mocked(fetchManagerClients).mockResolvedValue([hiper]);
    vi.mocked(updateContact).mockResolvedValue(makeContact());
  });

  it("suggests the company by the contact phone and saves the Manager codes with the names", async () => {
    renderWithProviders(<EditContactDialog contact={makeContact({ id: 5, name: "Maria" })} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Editar contato" });
    await waitFor(() => expect(fetchManagerClients).toHaveBeenCalledWith({ contactId: 5 }));

    await userEvent.selectOptions(within(dialog).getByLabelText("Empresa no Manager"), await within(dialog).findByRole("option", { name: "HIPER | Hiper Mercado" }));
    await userEvent.selectOptions(within(dialog).getByLabelText("Produto"), await within(dialog).findByRole("option", { name: "Sistema Fiscal" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(updateContact).toHaveBeenCalledWith(5, {
        name: "Maria",
        clientCompany: "HIPER",
        managerClientId: 123,
        product: "Sistema Fiscal",
        managerProductId: 8,
      }),
    );
  });

  it("keeps the saved company selected even when the search does not bring it", async () => {
    vi.mocked(fetchManagerClients).mockResolvedValue([]);
    renderWithProviders(
      <EditContactDialog
        contact={makeContact({ clientCompany: "PADARIA", managerClientId: 9, product: "Gestão Café", managerProductId: 7 })}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Editar contato" });
    expect(within(dialog).getByLabelText("Empresa no Manager")).toHaveDisplayValue("PADARIA");
    await waitFor(() => expect(within(dialog).getByLabelText("Produto")).toHaveDisplayValue("Gestão Café"));
  });
});
