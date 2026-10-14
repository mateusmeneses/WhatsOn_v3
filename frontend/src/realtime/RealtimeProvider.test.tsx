import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { io } from "socket.io-client";
import { useState } from "react";
import { refreshAccessToken } from "@/lib/api";
import type { FakeSocket } from "@/test/fakeSocket";
import { createTestQueryClient, setTestUser } from "@/test/utils";
import { RealtimeProvider, useRealtimeEvent, useTicketRoom } from "./RealtimeProvider";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  refreshAccessToken: vi.fn().mockResolvedValue(null),
}));

function lastSocket(): FakeSocket {
  return vi.mocked(io).mock.results.at(-1)!.value as FakeSocket;
}

function Probe({ ticketId }: { ticketId: number | null }) {
  const [last, setLast] = useState("nenhum");
  useRealtimeEvent<{ text: string }>("demo:event", (p) => setLast(p.text));
  useTicketRoom(ticketId);
  return <p>último: {last}</p>;
}

function renderProvider(ticketId: number | null = null) {
  setTestUser();
  const queryClient = createTestQueryClient();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider>
        <Probe ticketId={ticketId} />
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient, socket: lastSocket() };
}

describe("RealtimeProvider", () => {
  it("connects with the access token", () => {
    renderProvider();
    expect(io).toHaveBeenLastCalledWith(undefined, expect.objectContaining({ auth: { token: "test-token" } }));
  });

  it("delivers server events to subscribers after ready", () => {
    const { socket } = renderProvider();
    act(() => socket.serverEmit("ready"));
    act(() => socket.serverEmit("demo:event", { text: "olá" }));
    expect(screen.getByText("último: olá")).toBeInTheDocument();
  });

  it("refetches everything when the socket becomes ready again after a reconnect", () => {
    const { socket, queryClient } = renderProvider();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    act(() => socket.serverEmit("ready"));
    expect(spy).not.toHaveBeenCalled();
    act(() => socket.serverEmit("ready"));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("joins the ticket room on ready, rejoins after reconnect and leaves on unmount", () => {
    const { socket, unmount } = renderProvider(42);
    act(() => socket.serverEmit("ready"));
    act(() => socket.serverEmit("ready"));
    const joins = socket.emitted.filter((e) => e.event === "ticket:join");
    expect(joins).toHaveLength(2);
    expect(joins[0]?.args[0]).toBe(42);
    unmount();
    expect(socket.emitted.some((e) => e.event === "ticket:leave" && e.args[0] === 42)).toBe(true);
    expect(socket.disconnected).toBe(true);
  });

  it("renews the token when the server rejects the connection", async () => {
    const { socket } = renderProvider();
    await act(async () => socket.serverEmit("connect_error", new Error("UNAUTHENTICATED")));
    expect(refreshAccessToken).toHaveBeenCalled();
  });
});
