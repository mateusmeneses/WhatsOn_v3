import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FakeSocket } from "@/test/fakeSocket";
import { makeTicket } from "@/test/factories";
import { renderWithProviders, setTestUser } from "@/test/utils";
import type { ScheduledMessage } from "@/types/api";
import { cancelScheduled, createScheduled, fetchScheduled } from "./scheduledApi";
import { ScheduledMessages, toLocalInput } from "./ScheduledMessages";

vi.mock("./scheduledApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./scheduledApi")>()),
  fetchScheduled: vi.fn(),
  createScheduled: vi.fn(),
  cancelScheduled: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const row = (partial: Partial<ScheduledMessage> = {}): ScheduledMessage => ({
  id: 5,
  ticketId: 1,
  userId: 1,
  body: "Lembrete da consulta",
  sendAt: new Date(Date.now() + 3_600_000).toISOString(),
  status: "pending",
  error: null,
  ...partial,
});

describe("ScheduledMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTestUser({ id: 1, profile: "agent" });
  });

  it("schedules a message for the chosen date and time", async () => {
    vi.mocked(fetchScheduled).mockResolvedValue([]);
    vi.mocked(createScheduled).mockResolvedValue(row());
    renderWithProviders(<ScheduledMessages ticket={makeTicket({ status: "open", userId: 1 })} />);

    await userEvent.click(screen.getByRole("button", { name: /agendar mensagem/i }));
    const dialog = await screen.findByRole("dialog", { name: "Agendar mensagem" });
    await userEvent.type(within(dialog).getByLabelText("Mensagem"), "Lembrete da consulta");
    const when = new Date(Date.now() + 2 * 86_400_000);
    when.setSeconds(0, 0);
    fireEvent.change(within(dialog).getByLabelText("Enviar em"), { target: { value: toLocalInput(when) } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Agendar" }));

    await waitFor(() =>
      expect(createScheduled).toHaveBeenCalledWith(1, { body: "Lembrete da consulta", sendAt: when.toISOString() }),
    );
  });

  it("blocks a date in the past", async () => {
    vi.mocked(fetchScheduled).mockResolvedValue([]);
    renderWithProviders(<ScheduledMessages ticket={makeTicket({ status: "open", userId: 1 })} />);
    await userEvent.click(screen.getByRole("button", { name: /agendar mensagem/i }));
    const dialog = await screen.findByRole("dialog", { name: "Agendar mensagem" });
    await userEvent.type(within(dialog).getByLabelText("Mensagem"), "Oi");
    fireEvent.change(within(dialog).getByLabelText("Enviar em"), { target: { value: toLocalInput(new Date(Date.now() - 3_600_000)) } });
    expect(within(dialog).getByText("Escolha uma data e hora no futuro.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Agendar" })).toBeDisabled();
  });

  it("lists pending messages and cancels one", async () => {
    vi.mocked(fetchScheduled).mockResolvedValue([row()]);
    vi.mocked(cancelScheduled).mockResolvedValue(row({ status: "canceled" }));
    renderWithProviders(<ScheduledMessages ticket={makeTicket({ status: "open", userId: 1 })} />);

    await userEvent.click(await screen.findByRole("button", { name: /1 mensagem agendada/i }));
    expect(screen.getByText("Lembrete da consulta")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar agendamento" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar envio" }));
    await waitFor(() => expect(cancelScheduled).toHaveBeenCalledWith(5));
  });

  it("refreshes when the server reports a change", async () => {
    vi.mocked(fetchScheduled).mockResolvedValue([]);
    const socket = new FakeSocket();
    renderWithProviders(<ScheduledMessages ticket={makeTicket({ status: "open", userId: 1 })} />, { socket });
    await waitFor(() => expect(fetchScheduled).toHaveBeenCalledTimes(1));
    vi.mocked(fetchScheduled).mockResolvedValue([row()]);
    act(() => socket.serverEmit("scheduled:update", { ticketId: 1 }));
    expect(await screen.findByRole("button", { name: /1 mensagem agendada/i })).toBeInTheDocument();
  });
});
