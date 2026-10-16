import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppRoutes } from "@/app/routes";
import { fetchUserOptions } from "@/features/users/usersApi";
import { FakeSocket } from "@/test/fakeSocket";
import { makeContact, makeTicket } from "@/test/factories";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { fetchTickets } from "./ticketsApi";
import { TicketsPage } from "./TicketsPage";
import { TicketRealtime } from "./useTickets";

vi.mock("./ticketsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ticketsApi")>()),
  fetchTickets: vi.fn(),
  fetchTicketAttendants: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/features/users/usersApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/users/usersApi")>()),
  fetchUserOptions: vi.fn(),
}));
vi.mock("@/features/chat/ChatPanel", () => ({
  ChatPanel: ({ ticketId }: { ticketId: number }) => <div>chat do ticket {ticketId}</div>,
}));

const maria = makeTicket({ id: 1, contact: makeContact({ id: 1, name: "Maria Souza" }) });
const joao = makeTicket({ id: 2, contact: makeContact({ id: 2, name: "João Lima", number: "5521977776666" }) });

beforeEach(() => {
  vi.mocked(fetchUserOptions).mockResolvedValue([{ id: 1, name: "Ana", queueIds: [10] }]);
  vi.mocked(fetchTickets).mockImplementation(async (status) =>
    status === "pending" ? { items: [maria, joao], hasMore: false } : { items: [], hasMore: false },
  );
});

describe("TicketsPage", () => {
  it("lists pending tickets and hides the bot tab from agents", async () => {
    setTestUser({ id: 1, profile: "agent" });
    renderWithProviders(<TicketsPage />, { socket: new FakeSocket() });
    const list = await screen.findByRole("list", { name: "Lista de atendimentos" });
    expect(within(list).getByText("Maria Souza")).toBeInTheDocument();
    expect(within(list).getByText("João Lima")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Bot" })).not.toBeInTheDocument();
    expect(screen.getByText("Selecione um atendimento")).toBeInTheDocument();
  });

  it("shows the bot tab to supervisors and loads the selected tab", async () => {
    setTestUser({ id: 2, profile: "supervisor" });
    renderWithProviders(<TicketsPage />, { socket: new FakeSocket() });
    await userEvent.click(screen.getByRole("tab", { name: "Bot" }));
    await waitFor(() => expect(fetchTickets).toHaveBeenCalledWith("bot", "", 1));
  });

  it("searches by name with debounce", async () => {
    setTestUser({ id: 1, profile: "agent" });
    renderWithProviders(<TicketsPage />, { socket: new FakeSocket() });
    await screen.findByText("Maria Souza");
    await userEvent.type(screen.getByPlaceholderText("Buscar por nome ou número"), "maria");
    await waitFor(() => expect(fetchTickets).toHaveBeenCalledWith("pending", "maria", 1));
  });

  it("removes a ticket from the pending tab when another agent accepts it", async () => {
    setTestUser({ id: 1, profile: "agent" });
    const socket = new FakeSocket();
    renderWithProviders(
      <>
        <TicketRealtime />
        <TicketsPage />
      </>,
      { socket },
    );
    await screen.findByText("Maria Souza");
    await waitFor(() => expect(fetchUserOptions).toHaveBeenCalled());

    act(() => socket.serverEmit("ticket:update", { ...maria, status: "open", userId: 9 }));

    await waitFor(() => expect(screen.queryByText("Maria Souza")).not.toBeInTheDocument());
    expect(screen.getByText("João Lima")).toBeInTheDocument();
  });

  it("opens the chat of the selected ticket", async () => {
    setTestUser({ id: 1, profile: "agent" });
    renderWithProviders(<AppRoutes />, { route: "/atendimento" });
    await userEvent.click(await screen.findByRole("link", { name: /Maria Souza/ }));
    expect(await screen.findByText("chat do ticket 1")).toBeInTheDocument();
  });

  it("shows a ticket only once when it shows up again on the next page", async () => {
    setTestUser({ id: 1, profile: "agent" });
    vi.mocked(fetchTickets).mockImplementation(async (status, _search, page) => {
      if (status !== "pending") return { items: [], hasMore: false };
      return page === 1 ? { items: [maria], hasMore: true } : { items: [maria, joao], hasMore: false };
    });
    renderWithProviders(<TicketsPage />, { socket: new FakeSocket() });
    await userEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));

    const list = screen.getByRole("list", { name: "Lista de atendimentos" });
    await within(list).findByText("João Lima");
    expect(within(list).getAllByText("Maria Souza")).toHaveLength(1);
  });
});
