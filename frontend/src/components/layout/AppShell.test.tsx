import { act, screen } from "@testing-library/react";
import { io } from "socket.io-client";
import { AppRoutes } from "@/app/routes";
import { fetchContacts } from "@/features/contacts/contactsApi";
import type { FakeSocket } from "@/test/fakeSocket";
import { renderWithProviders, setTestUser } from "@/test/utils";

vi.mock("@/features/contacts/contactsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/contacts/contactsApi")>()),
  fetchContacts: vi.fn(),
}));

function lastSocket(): FakeSocket {
  return vi.mocked(io).mock.results.at(-1)!.value as FakeSocket;
}

beforeEach(() => {
  vi.mocked(io).mockClear();
  vi.mocked(fetchContacts).mockResolvedValue({ items: [], hasMore: false });
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
});
