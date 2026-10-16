import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppRoutes } from "@/app/routes";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { QueuesPage } from "./QueuesPage";
import { createQueue, deleteQueue, fetchQueues } from "./queuesApi";

vi.mock("./queuesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./queuesApi")>()),
  fetchQueues: vi.fn(),
  createQueue: vi.fn(),
  updateQueue: vi.fn(),
  deleteQueue: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.mocked(fetchQueues).mockResolvedValue([
    { id: 10, companyId: 1, name: "Suporte", color: "#6d5dfc", schedule: { "1": ["08:00-18:00"] } },
  ]);
});

describe("QueuesPage", () => {
  it("lists queues with their schedule summary", async () => {
    setTestUser({ profile: "admin" });
    renderWithProviders(<QueuesPage />);
    expect(await screen.findByText("Suporte")).toBeInTheDocument();
    expect(screen.getByText("Seg")).toBeInTheDocument();
  });

  it("creates a queue with a custom weekly schedule", async () => {
    setTestUser({ profile: "admin" });
    vi.mocked(createQueue).mockResolvedValue({ id: 11, companyId: 1, name: "Financeiro", color: "#6d5dfc", schedule: {} });
    renderWithProviders(<QueuesPage />);
    await screen.findByText("Suporte");

    await userEvent.click(screen.getByRole("button", { name: "Nova fila" }));
    const dialog = screen.getByRole("dialog", { name: "Nova fila" });
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Financeiro");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Sempre aberto" }));
    fireEvent.change(within(dialog).getByLabelText("Segunda fim 1"), { target: { value: "12:00" } });
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Sexta aberto" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(createQueue).toHaveBeenCalledWith({
        name: "Financeiro",
        color: "#0a6ad6",
        schedule: {
          "0": [],
          "1": ["08:00-12:00"],
          "2": ["08:00-18:00"],
          "3": ["08:00-18:00"],
          "4": ["08:00-18:00"],
          "5": [],
          "6": [],
        },
      }),
    );
  });

  it("blocks saving an inverted range", async () => {
    setTestUser({ profile: "admin" });
    renderWithProviders(<QueuesPage />);
    await screen.findByText("Suporte");
    await userEvent.click(screen.getByRole("button", { name: "Editar Suporte" }));
    const dialog = screen.getByRole("dialog", { name: "Editar fila" });
    fireEvent.change(within(dialog).getByLabelText("Segunda fim 1"), { target: { value: "07:00" } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Segunda: o início deve ser antes do fim.");
    expect(within(dialog).getByRole("button", { name: "Salvar" })).toBeDisabled();
  });

  it("deletes a queue after confirmation", async () => {
    setTestUser({ profile: "admin" });
    vi.mocked(deleteQueue).mockResolvedValue();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<QueuesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Excluir Suporte" }));
    await waitFor(() => expect(deleteQueue).toHaveBeenCalledWith(10));
  });

  it("is only reachable by admins", async () => {
    setTestUser({ profile: "agent" });
    renderWithProviders(<AppRoutes />, { route: "/filas" });
    expect(await screen.findByRole("heading", { name: "Atendimentos" })).toBeInTheDocument();
  });
});
