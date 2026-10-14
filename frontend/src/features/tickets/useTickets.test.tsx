import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Socket } from "socket.io-client";
import { RealtimeContext } from "@/realtime/RealtimeProvider";
import { FakeSocket } from "@/test/fakeSocket";
import { makeTicket } from "@/test/factories";
import { createTestQueryClient, setTestUser } from "@/test/utils";
import { fetchUserOptions } from "@/features/users/usersApi";
import { ticketKeys } from "./ticketsApi";
import type { TicketPages } from "./ticketCache";
import { useTicketRealtime, useViewer } from "./useTickets";

vi.mock("@/features/users/usersApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/users/usersApi")>()),
  fetchUserOptions: vi.fn(),
}));

describe("useTicketRealtime", () => {
  it("applies ticket:update events to the cached lists using the agent's queues", async () => {
    setTestUser({ id: 1, profile: "agent" });
    vi.mocked(fetchUserOptions).mockResolvedValue([{ id: 1, name: "Ana", queueIds: [10] }]);
    const qc = createTestQueryClient();
    qc.setQueryData(ticketKeys.list("pending", ""), { pages: [{ items: [], hasMore: false }], pageParams: [1] });
    const socket = new FakeSocket();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>
        <RealtimeContext.Provider value={{ socket: socket as unknown as Socket, epoch: 1, connected: true }}>{children}</RealtimeContext.Provider>
      </QueryClientProvider>
    );

    const { result } = renderHook(
      () => {
        useTicketRealtime();
        return useViewer();
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current?.queueIds).toEqual([10]));

    act(() => socket.serverEmit("ticket:update", makeTicket({ id: 5, queueId: 10 })));

    const items = qc.getQueryData<TicketPages>(ticketKeys.list("pending", ""))!.pages[0]!.items;
    expect(items.map((t) => t.id)).toEqual([5]);
  });
});
