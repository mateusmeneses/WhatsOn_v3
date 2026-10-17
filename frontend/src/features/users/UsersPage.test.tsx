import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fetchQueues } from "@/features/queues/queuesApi";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { UsersPage } from "./UsersPage";
import { createUser, fetchUsers, resetUserAccess, updateUser } from "./usersApi";

vi.mock("./usersApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./usersApi")>()),
  fetchUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  resetUserAccess: vi.fn(),
}));
vi.mock("@/features/queues/queuesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/queues/queuesApi")>()),
  fetchQueues: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.mocked(fetchQueues).mockResolvedValue([
    { id: 10, companyId: 1, name: "Suporte", color: "#6d5dfc", schedule: {} },
    { id: 20, companyId: 1, name: "Financeiro", color: "#16a34a", schedule: {} },
  ]);
  vi.mocked(fetchUsers).mockResolvedValue([
    { id: 1, companyId: 1, name: "Ana Admin", email: "ana@test.local", profile: "admin", queueIds: [] },
    { id: 2, companyId: 1, name: "Bruno", email: "bruno@test.local", profile: "agent", queueIds: [10] },
  ]);
});

describe("UsersPage", () => {
  it("lists users with profile and queues", async () => {
    setTestUser({ id: 1, profile: "admin" });
    renderWithProviders(<UsersPage />);
    const row = (await screen.findByText("Bruno")).closest("tr")!;
    expect(within(row).getByText("Atendente")).toBeInTheDocument();
    expect(await within(row).findByText("Suporte")).toBeInTheDocument();
  });

  it("creates an agent without sending the access by default", async () => {
    setTestUser({ id: 1, profile: "admin" });
    vi.mocked(createUser).mockResolvedValue({
      id: 3, companyId: 1, name: "Carla", email: "carla@test.local", profile: "agent", queueIds: [20], access: { sent: true },
    });
    renderWithProviders(<UsersPage />);
    await screen.findByText("Bruno");

    await userEvent.click(screen.getByRole("button", { name: "Novo usuário" }));
    const dialog = screen.getByRole("dialog", { name: "Novo usuário" });
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Carla");
    await userEvent.type(within(dialog).getByLabelText("E-mail"), "carla@test.local");
    expect(within(dialog).queryByLabelText(/senha/i)).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("WhatsApp"), "(11) 98888-7777");
    await userEvent.click(await within(dialog).findByRole("checkbox", { name: "Financeiro" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(createUser).toHaveBeenCalledWith({
        name: "Carla",
        email: "carla@test.local",
        phone: "(11) 98888-7777",
        profile: "agent",
        queueIds: [20],
        canViewBot: false, canViewOtherQueues: false, canViewOthersOpen: false,
        sendAccess: false,
      }),
    );
    expect(screen.queryByText("Acesso não enviado")).not.toBeInTheDocument();
  });

  it("saves the ticket visibility permissions of an agent", async () => {
    setTestUser({ id: 1, profile: "admin" });
    vi.mocked(createUser).mockResolvedValue({
      id: 3, companyId: 1, name: "Carla", email: "carla@test.local", profile: "agent", queueIds: [], access: { sent: true },
    });
    renderWithProviders(<UsersPage />);
    await screen.findByText("Bruno");

    await userEvent.click(screen.getByRole("button", { name: "Novo usuário" }));
    const dialog = screen.getByRole("dialog", { name: "Novo usuário" });
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Carla");
    await userEvent.type(within(dialog).getByLabelText("E-mail"), "carla@test.local");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Ver atendimentos no bot (sem setor)" }));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Ver aguardando de outros setores" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(createUser).toHaveBeenCalledWith(
        expect.objectContaining({ canViewBot: true, canViewOtherQueues: true, canViewOthersOpen: false }),
      ),
    );
  });

  it("hides the ticket permissions for supervisors and admins", async () => {
    setTestUser({ id: 1, profile: "admin" });
    renderWithProviders(<UsersPage />);
    await screen.findByText("Bruno");
    await userEvent.click(screen.getByRole("button", { name: "Novo usuário" }));
    const dialog = screen.getByRole("dialog", { name: "Novo usuário" });
    expect(within(dialog).getByText("Permissões de atendimento")).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText("Perfil"), "supervisor");
    expect(within(dialog).queryByText("Permissões de atendimento")).not.toBeInTheDocument();
  });

  it("sends the access on creation when the admin ticks the option", async () => {
    setTestUser({ id: 1, profile: "admin" });
    vi.mocked(createUser).mockResolvedValue({
      id: 3, companyId: 1, name: "Carla", email: "carla@test.local", profile: "agent", queueIds: [], access: { sent: true },
    });
    renderWithProviders(<UsersPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Novo usuário" }));
    const dialog = screen.getByRole("dialog", { name: "Novo usuário" });
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Carla");
    await userEvent.type(within(dialog).getByLabelText("E-mail"), "carla@test.local");
    const send = within(dialog).getByRole("checkbox", { name: "Enviar acesso por WhatsApp agora" });
    expect(send).not.toBeChecked();
    await userEvent.click(send);
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ sendAccess: true })));
  });

  it("shows the temporary password when WhatsApp could not deliver it", async () => {
    setTestUser({ id: 1, profile: "admin" });
    vi.mocked(createUser).mockResolvedValue({
      id: 3, companyId: 1, name: "Carla", email: "carla@test.local", profile: "agent", queueIds: [],
      phone: null, access: { sent: false, temporaryPassword: "Xy7kPq2mNa" },
    });
    renderWithProviders(<UsersPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Novo usuário" }));
    const dialog = screen.getByRole("dialog", { name: "Novo usuário" });
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Carla");
    await userEvent.type(within(dialog).getByLabelText("E-mail"), "carla@test.local");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Enviar acesso por WhatsApp agora" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    const result = await screen.findByRole("dialog", { name: "Acesso não enviado" });
    expect(within(result).getByTestId("temporary-password")).toHaveTextContent("Xy7kPq2mNa");
  });

  it("sends the access after confirming", async () => {
    setTestUser({ id: 1, profile: "admin" });
    vi.mocked(resetUserAccess).mockResolvedValue({
      id: 2, companyId: 1, name: "Bruno", email: "bruno@test.local", profile: "agent", queueIds: [10], access: { sent: true },
    });
    renderWithProviders(<UsersPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Enviar acesso para Bruno" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(resetUserAccess).toHaveBeenCalledWith(2));
  });

  it("edits without sending an empty password", async () => {
    setTestUser({ id: 1, profile: "admin" });
    vi.mocked(updateUser).mockResolvedValue({
      id: 2, companyId: 1, name: "Bruno Lima", email: "bruno@test.local", profile: "agent", queueIds: [10],
    });
    renderWithProviders(<UsersPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Editar Bruno" }));
    const dialog = screen.getByRole("dialog", { name: "Editar usuário" });
    const name = within(dialog).getByLabelText("Nome");
    await userEvent.clear(name);
    await userEvent.type(name, "Bruno Lima");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith(2, {
        name: "Bruno Lima",
        email: "bruno@test.local",
        phone: null,
        profile: "agent",
        queueIds: [10],
        canViewBot: false, canViewOtherQueues: false, canViewOthersOpen: false,
      }),
    );
  });

  it("lets supervisors only read the list", async () => {
    setTestUser({ id: 5, profile: "supervisor" });
    renderWithProviders(<UsersPage />);
    await screen.findByText("Bruno");
    expect(screen.queryByRole("button", { name: "Novo usuário" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar Bruno" })).not.toBeInTheDocument();
  });
});
