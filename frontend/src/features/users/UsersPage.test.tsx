import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fetchQueues } from "@/features/queues/queuesApi";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { UsersPage } from "./UsersPage";
import { createUser, fetchUsers, updateUser } from "./usersApi";

vi.mock("./usersApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./usersApi")>()),
  fetchUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
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

  it("creates an agent linked to a queue", async () => {
    setTestUser({ id: 1, profile: "admin" });
    vi.mocked(createUser).mockResolvedValue({
      id: 3, companyId: 1, name: "Carla", email: "carla@test.local", profile: "agent", queueIds: [20],
    });
    renderWithProviders(<UsersPage />);
    await screen.findByText("Bruno");

    await userEvent.click(screen.getByRole("button", { name: "Novo usuário" }));
    const dialog = screen.getByRole("dialog", { name: "Novo usuário" });
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Carla");
    await userEvent.type(within(dialog).getByLabelText("E-mail"), "carla@test.local");
    await userEvent.type(within(dialog).getByLabelText("Senha"), "senha123");
    await userEvent.click(await within(dialog).findByRole("checkbox", { name: "Financeiro" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(createUser).toHaveBeenCalledWith({
        name: "Carla",
        email: "carla@test.local",
        password: "senha123",
        profile: "agent",
        queueIds: [20],
      }),
    );
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
        profile: "agent",
        queueIds: [10],
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
