import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { toast } from "sonner";
import { fetchQueues } from "@/features/queues/queuesApi";
import { fetchUserOptions } from "@/features/users/usersApi";
import { makeTicket } from "@/test/factories";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { TicketActions } from "./TicketActions";
import { acceptTicket, closeTicket, reopenTicket, transferTicket } from "./ticketsApi";

vi.mock("./ticketsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ticketsApi")>()),
  acceptTicket: vi.fn(),
  closeTicket: vi.fn(),
  transferTicket: vi.fn(),
  reopenTicket: vi.fn(),
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

function conflict(message: string) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError("conflict", "ERR", config, null, {
    status: 409,
    statusText: "",
    headers: {},
    config,
    data: { error: { code: "TICKET_ALREADY_ACCEPTED", message } },
  });
}

beforeEach(() => {
  vi.mocked(fetchQueues).mockResolvedValue([
    { id: 10, companyId: 1, name: "Suporte", color: "#6d5dfc", schedule: {} },
    { id: 20, companyId: 1, name: "Financeiro", color: "#16a34a", schedule: {} },
  ]);
  vi.mocked(fetchUserOptions).mockResolvedValue([
    { id: 1, name: "Ana", queueIds: [10] },
    { id: 2, name: "Bruno", queueIds: [20] },
  ]);
});

describe("TicketActions", () => {
  it("accepts a pending ticket", async () => {
    setTestUser({ id: 1, profile: "agent" });
    vi.mocked(acceptTicket).mockResolvedValue(makeTicket({ status: "open", userId: 1 }));
    renderWithProviders(<TicketActions ticket={makeTicket({ status: "pending" })} />);
    await userEvent.click(screen.getByRole("button", { name: /aceitar/i }));
    await waitFor(() => expect(acceptTicket).toHaveBeenCalledWith(1));
    expect(toast.success).toHaveBeenCalledWith("Atendimento aceito");
  });

  it("explains when someone else accepted first", async () => {
    setTestUser({ id: 1, profile: "agent" });
    vi.mocked(acceptTicket).mockRejectedValue(conflict("Este atendimento já foi aceito por Bruno"));
    renderWithProviders(<TicketActions ticket={makeTicket({ status: "pending" })} />);
    await userEvent.click(screen.getByRole("button", { name: /aceitar/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Este atendimento já foi aceito por Bruno"));
  });

  it("transfers an owned ticket to another queue", async () => {
    setTestUser({ id: 1, profile: "agent" });
    vi.mocked(transferTicket).mockResolvedValue(makeTicket({ status: "pending", queueId: 20, userId: null }));
    renderWithProviders(<TicketActions ticket={makeTicket({ status: "open", userId: 1 })} />);

    await userEvent.click(screen.getByRole("button", { name: /transferir/i }));
    const dialog = await screen.findByRole("dialog", { name: "Transferir atendimento" });
    await within(dialog).findByRole("option", { name: "Financeiro" });
    await userEvent.selectOptions(within(dialog).getByLabelText("Fila"), "20");
    await userEvent.click(within(dialog).getByRole("button", { name: "Transferir" }));

    await waitFor(() => expect(transferTicket).toHaveBeenCalledWith(1, { queueId: 20 }));
  });

  it("transfers to a specific agent", async () => {
    setTestUser({ id: 1, profile: "supervisor" });
    vi.mocked(transferTicket).mockResolvedValue(makeTicket({ status: "pending", userId: 2 }));
    renderWithProviders(<TicketActions ticket={makeTicket({ status: "open", userId: 1 })} />);

    await userEvent.click(screen.getByRole("button", { name: /transferir/i }));
    const dialog = await screen.findByRole("dialog", { name: "Transferir atendimento" });
    await userEvent.click(within(dialog).getByRole("tab", { name: "Para um atendente" }));
    await within(dialog).findByRole("option", { name: "Bruno" });
    await userEvent.selectOptions(within(dialog).getByLabelText("Atendente"), "2");
    await userEvent.click(within(dialog).getByRole("button", { name: "Transferir" }));

    await waitFor(() => expect(transferTicket).toHaveBeenCalledWith(1, { userId: 2 }));
  });

  it("asks for confirmation before closing", async () => {
    setTestUser({ id: 1, profile: "agent" });
    vi.mocked(closeTicket).mockResolvedValue(makeTicket({ status: "closed", userId: 1 }));
    renderWithProviders(<TicketActions ticket={makeTicket({ status: "open", userId: 1 })} />);

    // cancela: abre o diálogo e desiste
    await userEvent.click(screen.getByRole("button", { name: /finalizar/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(closeTicket).not.toHaveBeenCalled();

    // confirma: reabre e clica em Finalizar dentro do diálogo
    await userEvent.click(screen.getByRole("button", { name: /finalizar/i }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Finalizar" }));
    await waitFor(() => expect(closeTicket).toHaveBeenCalledWith(1, true));
  });

  it("closes without the closing message when the box is unticked", async () => {
    setTestUser({ id: 1, profile: "agent" });
    vi.mocked(closeTicket).mockResolvedValue(makeTicket({ status: "closed", userId: 1 }));
    renderWithProviders(<TicketActions ticket={makeTicket({ status: "open", userId: 1 })} />);
    await userEvent.click(screen.getByRole("button", { name: /finalizar/i }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Enviar mensagem de finalização" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Finalizar" }));
    await waitFor(() => expect(closeTicket).toHaveBeenCalledWith(1, false));
  });

  it("shows the accept button on tickets still in the bot", () => {
    setTestUser({ id: 2, profile: "supervisor" });
    renderWithProviders(<TicketActions ticket={makeTicket({ status: "bot" })} />);
    expect(screen.getByRole("button", { name: /aceitar/i })).toBeInTheDocument();
  });

  it("reopens an own closed ticket after confirming", async () => {
    setTestUser({ id: 1, profile: "agent" });
    vi.mocked(reopenTicket).mockResolvedValue(makeTicket({ status: "open", userId: 1 }));
    renderWithProviders(<TicketActions ticket={makeTicket({ status: "closed", userId: 1 })} />);
    expect(screen.queryByRole("button", { name: /finalizar/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /reabrir/i }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Reabrir" }));
    await waitFor(() => expect(reopenTicket).toHaveBeenCalledWith(1));
    expect(toast.success).toHaveBeenCalledWith("Atendimento reaberto");
  });

  it("does not let an agent reopen someone else's closed ticket", () => {
    setTestUser({ id: 1, profile: "agent" });
    renderWithProviders(<TicketActions ticket={makeTicket({ status: "closed", userId: 9 })} />);
    expect(screen.queryByRole("button", { name: /reabrir/i })).not.toBeInTheDocument();
  });

  it("offers no actions to an agent looking at someone else's ticket", () => {
    setTestUser({ id: 1, profile: "agent" });
    renderWithProviders(<TicketActions ticket={makeTicket({ status: "open", userId: 9 })} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
