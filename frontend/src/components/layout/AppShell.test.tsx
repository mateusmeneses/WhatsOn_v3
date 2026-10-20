import { act, screen, waitFor } from "@testing-library/react";
import { io } from "socket.io-client";
import { AppRoutes } from "@/app/routes";
import { fetchContacts } from "@/features/contacts/contactsApi";
import { api } from "@/lib/api";
import { ticketKeys } from "@/features/tickets/ticketsApi";
import type { TicketPages } from "@/features/tickets/ticketCache";
import { fetchUserOptions } from "@/features/users/usersApi";
import type { FakeSocket } from "@/test/fakeSocket";
import { makeTicket } from "@/test/factories";
import { createTestQueryClient, renderWithProviders, setTestUser } from "@/test/utils";

vi.mock("@/features/contacts/contactsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/contacts/contactsApi")>()),
  fetchContacts: vi.fn(),
}));
vi.mock("@/features/users/usersApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/users/usersApi")>()),
  fetchUserOptions: vi.fn(),
}));

function lastSocket(): FakeSocket {
  return vi.mocked(io).mock.results.at(-1)!.value as FakeSocket;
}

beforeEach(() => {
  vi.mocked(io).mockClear();
  vi.mocked(fetchContacts).mockResolvedValue({ items: [], hasMore: false });
  vi.mocked(fetchUserOptions).mockResolvedValue([{ id: 1, name: "Ana", queueIds: [10] }]);
});

describe("AppShell", () => {
  it("shows a reconnecting banner while the socket is down after the first ready", async () => {
    setTestUser({ profile: "agent" });
    renderWithProviders(<AppRoutes />, { route: "/contatos" });
    await screen.findByRole("heading", { name: "Contatos" });
    const socket = lastSocket();
    expect(screen.queryByText("Reconectando ao servidor…")).not.toBeInTheDocument();

    act(() => socket.serverEmit("ready"));
    expect(screen.queryByText("Reconectando ao servidor…")).not.toBeInTheDocument();

    act(() => socket.serverEmit("disconnect", "transport close"));
    expect(screen.getByRole("status")).toHaveTextContent("Reconectando ao servidor…");

    act(() => socket.serverEmit("ready"));
    expect(screen.queryByText("Reconectando ao servidor…")).not.toBeInTheDocument();
  });

  it("applies ticket:update to the cached ticket lists while on another page", async () => {
    setTestUser({ id: 1, profile: "agent" });
    const queryClient = createTestQueryClient();
    queryClient.setQueryData<TicketPages>(ticketKeys.list("pending", ""), {
      pages: [{ items: [], hasMore: false }],
      pageParams: [1],
    });
    renderWithProviders(<AppRoutes />, { route: "/contatos", queryClient });
    await screen.findByRole("heading", { name: "Contatos" });
    const socket = lastSocket();
    act(() => socket.serverEmit("ready"));
    await waitFor(() => expect(fetchUserOptions).toHaveBeenCalled());
    await waitFor(() => expect(queryClient.getQueryData(["users", "options"])).toBeDefined());

    act(() => socket.serverEmit("ticket:update", makeTicket({ id: 7, queueId: 10 })));

    const items = queryClient.getQueryData<TicketPages>(ticketKeys.list("pending", ""))!.pages[0]!.items;
    expect(items.map((t) => t.id)).toEqual([7]);
  });
});

describe("AppShell counters", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows unread messages in the tab title and waiting tickets on the menu", async () => {
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/tickets/summary") return { data: { pending: 4, mine: 1, unread: 7 } };
      return { data: url === "/contacts" ? { items: [], hasMore: false } : [] };
    });
    setTestUser({ profile: "admin" });
    renderWithProviders(<AppRoutes />, { route: "/contatos" });
    await waitFor(() => expect(document.title).toBe("(7) Contatos · WhatsOn"));
    expect(await screen.findByRole("link", { name: "Atendimento, 4 aguardando" })).toBeInTheDocument();
  });
});

describe("AppShell page title", () => {
  it("names the browser tab after the current screen", async () => {
    setTestUser({ profile: "admin" });
    renderWithProviders(<AppRoutes />, { route: "/contatos" });
    await waitFor(() => expect(document.title).toBe("Contatos · WhatsOn"));
  });
});
