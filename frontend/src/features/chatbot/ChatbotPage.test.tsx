import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fetchConnections } from "@/features/connections/connectionsApi";
import { fetchQueues } from "@/features/queues/queuesApi";
import { fetchUserOptions } from "@/features/users/usersApi";
import { FakeSocket } from "@/test/fakeSocket";
import { renderWithProviders, setTestUser } from "@/test/utils";
import type { ChatbotNode, Connection } from "@/types/api";
import { createNode, fetchNodes, reorderChildren, simulate } from "./chatbotApi";
import { ChatbotPage } from "./ChatbotPage";

vi.mock("./chatbotApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./chatbotApi")>()),
  fetchNodes: vi.fn(),
  createNode: vi.fn(),
  updateNode: vi.fn(),
  deleteNode: vi.fn(),
  reorderChildren: vi.fn(),
  simulate: vi.fn(),
}));
vi.mock("@/features/connections/connectionsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/connections/connectionsApi")>()),
  fetchConnections: vi.fn(),
}));
vi.mock("@/features/queues/queuesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/queues/queuesApi")>()),
  fetchQueues: vi.fn(),
}));
vi.mock("@/features/users/usersApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/users/usersApi")>()),
  fetchUserOptions: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const node = (partial: Partial<ChatbotNode> & Pick<ChatbotNode, "id">): ChatbotNode => ({
  companyId: 1,
  connectionId: 1,
  parentId: null,
  order: 0,
  key: "",
  title: "",
  action: "submenu",
  message: "",
  mediaUrl: null,
  mediaMime: null,
  mediaName: null,
  queueId: null,
  userId: null,
  ...partial,
});

const connection: Connection = {
  id: 1,
  companyId: 1,
  name: "Principal",
  instanceName: "wo_1",
  status: "connected",
  number: null,
  isDefault: true,
  defaultQueueId: 10,
  outOfHoursMessage: "",
  closingMessage: "",
  transferMessage: "",
  botTimeoutMinutes: 30,
};

const tree = [
  node({ id: 1, message: "Olá! Escolha:", title: "Início" }),
  node({ id: 2, parentId: 1, order: 1, key: "1", title: "Financeiro", action: "submenu" }),
  node({ id: 3, parentId: 1, order: 2, key: "2", title: "Encerrar", action: "close" }),
];

beforeEach(() => {
  setTestUser({ profile: "admin" });
  vi.mocked(fetchConnections).mockResolvedValue([connection]);
  vi.mocked(fetchQueues).mockResolvedValue([{ id: 10, companyId: 1, name: "Suporte", color: "#6d5dfc", schedule: {} }]);
  vi.mocked(fetchUserOptions).mockResolvedValue([{ id: 1, name: "Ana", queueIds: [10] }]);
});

function renderPage() {
  return renderWithProviders(<ChatbotPage />, { socket: new FakeSocket() });
}

describe("ChatbotPage", () => {
  it("creates the welcome message when the bot is empty", async () => {
    vi.mocked(fetchNodes).mockResolvedValue([]);
    vi.mocked(createNode).mockResolvedValue(node({ id: 1, message: "Olá! Escolha uma opção:" }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Criar mensagem de boas-vindas" }));
    await waitFor(() =>
      expect(createNode).toHaveBeenCalledWith(1, { parentId: null, message: "Olá! Escolha uma opção:" }),
    );
  });

  it("shows options in order and reorders them", async () => {
    vi.mocked(fetchNodes).mockResolvedValue(tree);
    vi.mocked(reorderChildren).mockResolvedValue([]);
    renderPage();
    const options = await screen.findAllByTestId("bot-option");
    expect(options.map((o) => within(o).getByTestId("bot-option-title").textContent)).toEqual(["Financeiro", "Encerrar"]);
    await userEvent.click(screen.getByRole("button", { name: "Mover Financeiro para baixo" }));
    await waitFor(() => expect(reorderChildren).toHaveBeenCalledWith(1, [3, 2]));
  });

  it("adds a transfer option to the main menu", async () => {
    vi.mocked(fetchNodes).mockResolvedValue(tree);
    vi.mocked(createNode).mockResolvedValue(node({ id: 4, parentId: 1, key: "3", title: "Suporte", action: "transfer_queue", queueId: 10 }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Adicionar opção em Início" }));
    const form = screen.getByRole("form", { name: "Opção do chatbot" });
    expect(within(form).getByLabelText("Número")).toHaveValue("3");
    await userEvent.type(within(form).getByLabelText("Título"), "Suporte");
    await userEvent.selectOptions(within(form).getByLabelText("Ação"), "transfer_queue");
    expect(within(form).getByRole("button", { name: "Salvar" })).toBeDisabled();
    await within(form).findByRole("option", { name: "Suporte" });
    await userEvent.selectOptions(within(form).getByLabelText("Fila"), "10");
    await userEvent.click(within(form).getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(createNode).toHaveBeenCalledWith(1, {
        parentId: 1,
        key: "3",
        title: "Suporte",
        action: "transfer_queue",
        message: "",
        mediaUrl: null,
        mediaMime: null,
        mediaName: null,
        queueId: 10,
        userId: null,
      }),
    );
  });

  it("simulates a conversation", async () => {
    vi.mocked(fetchNodes).mockResolvedValue(tree);
    vi.mocked(simulate)
      .mockResolvedValueOnce({
        effects: [{ type: "send_text", text: "Olá! Escolha:\n\n1 - Financeiro\n2 - Encerrar" }],
        state: { nodeId: 1, attempts: 0 },
        finished: false,
      })
      .mockResolvedValueOnce({
        effects: [{ type: "send_text", text: "Aguarde" }, { type: "transfer", queueId: 10, userId: null }],
        state: { nodeId: null, attempts: 0 },
        finished: true,
      });
    renderPage();
    const sim = await screen.findByRole("region", { name: "Simulador" });

    await userEvent.type(within(sim).getByLabelText("Mensagem do cliente"), "oi{Enter}");
    expect(await within(sim).findByText(/1 - Financeiro/)).toBeInTheDocument();
    expect(simulate).toHaveBeenLastCalledWith(1, { nodeId: null, attempts: 0 }, "oi");

    await userEvent.type(within(sim).getByLabelText("Mensagem do cliente"), "1{Enter}");
    expect(await within(sim).findByText("Transferido para a fila Suporte")).toBeInTheDocument();
    expect(simulate).toHaveBeenLastCalledWith(1, { nodeId: 1, attempts: 0 }, "1");
    expect(within(sim).getByLabelText("Mensagem do cliente")).toBeDisabled();

    await userEvent.click(within(sim).getByRole("button", { name: "Reiniciar" }));
    expect(within(sim).queryByText("Transferido para a fila Suporte")).not.toBeInTheDocument();
  });
});
