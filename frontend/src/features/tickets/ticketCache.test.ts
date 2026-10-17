import { makeTicket } from "@/test/factories";
import { createTestQueryClient } from "@/test/utils";
import { ticketKeys } from "./ticketsApi";
import { applyTicketUpdate, upsertTicket, type TicketPages } from "./ticketCache";

const pages = (...ids: Array<{ id: number; at: string }>): TicketPages => ({
  pages: [{ items: ids.map(({ id, at }) => makeTicket({ id, lastMessageAt: at })), hasMore: false }],
  pageParams: [1],
});

describe("upsertTicket", () => {
  it("moves an updated ticket to the top by last message time", () => {
    const data = pages({ id: 1, at: "2026-10-14T10:00:00Z" }, { id: 2, at: "2026-10-14T09:00:00Z" });
    const result = upsertTicket(data, makeTicket({ id: 2, lastMessageAt: "2026-10-14T11:00:00Z" }), true);
    expect(result.pages[0]!.items.map((t) => t.id)).toEqual([2, 1]);
  });

  it("removes a ticket that no longer belongs to the list", () => {
    const data = pages({ id: 1, at: "2026-10-14T10:00:00Z" }, { id: 2, at: "2026-10-14T09:00:00Z" });
    const result = upsertTicket(data, makeTicket({ id: 1 }), false);
    expect(result.pages[0]!.items.map((t) => t.id)).toEqual([2]);
  });
});

describe("applyTicketUpdate", () => {
  const viewer = { userId: 1, profile: "agent" as const, queueIds: [10], canViewBot: false, canViewOtherQueues: false, canViewOthersOpen: false };

  it("moves a ticket from the pending tab to the open tab when the agent accepts it", () => {
    const qc = createTestQueryClient();
    qc.setQueryData(ticketKeys.list("pending", ""), pages({ id: 1, at: "2026-10-14T10:00:00Z" }));
    qc.setQueryData(ticketKeys.list("open", ""), { pages: [{ items: [], hasMore: false }], pageParams: [1] });

    applyTicketUpdate(qc, makeTicket({ id: 1, status: "open", userId: 1 }), viewer);

    expect(qc.getQueryData<TicketPages>(ticketKeys.list("pending", ""))!.pages[0]!.items).toHaveLength(0);
    expect(qc.getQueryData<TicketPages>(ticketKeys.list("open", ""))!.pages[0]!.items.map((t) => t.id)).toEqual([1]);
    expect(qc.getQueryData(ticketKeys.detail(1))).toMatchObject({ status: "open" });
  });

  it("removes the ticket from the agent's open tab when it is transferred to someone else", () => {
    const qc = createTestQueryClient();
    qc.setQueryData(
      ticketKeys.list("open", ""),
      { pages: [{ items: [makeTicket({ id: 3, status: "open", userId: 1 })], hasMore: false }], pageParams: [1] },
    );
    applyTicketUpdate(qc, makeTicket({ id: 3, status: "pending", userId: 9, queueId: 20 }), viewer);
    expect(qc.getQueryData<TicketPages>(ticketKeys.list("open", ""))!.pages[0]!.items).toHaveLength(0);
  });

  it("respects the search term of each cached list", () => {
    const qc = createTestQueryClient();
    qc.setQueryData(ticketKeys.list("pending", "joão"), { pages: [{ items: [], hasMore: false }], pageParams: [1] });
    applyTicketUpdate(qc, makeTicket({ id: 4 }), viewer);
    expect(qc.getQueryData<TicketPages>(ticketKeys.list("pending", "joão"))!.pages[0]!.items).toHaveLength(0);
  });
});
