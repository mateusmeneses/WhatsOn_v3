import { makeContact, makeTicket } from "@/test/factories";
import { matchesSearch, ticketVisibleIn, type Viewer } from "./visibility";

const agent: Viewer = { userId: 1, profile: "agent", queueIds: [10] };
const supervisor: Viewer = { userId: 2, profile: "supervisor", queueIds: [] };

describe("ticketVisibleIn", () => {
  it("shows agents pending tickets of their queues, without queue, or assigned to them", () => {
    expect(ticketVisibleIn(makeTicket({ queueId: 10 }), "pending", agent)).toBe(true);
    expect(ticketVisibleIn(makeTicket({ queueId: null }), "pending", agent)).toBe(true);
    expect(ticketVisibleIn(makeTicket({ queueId: 20, userId: 1 }), "pending", agent)).toBe(true);
    expect(ticketVisibleIn(makeTicket({ queueId: 20 }), "pending", agent)).toBe(false);
    expect(ticketVisibleIn(makeTicket({ queueId: 10, userId: 5 }), "pending", agent)).toBe(false);
  });

  it("shows agents only their own open and closed tickets and never bot tickets", () => {
    expect(ticketVisibleIn(makeTicket({ status: "open", userId: 1 }), "open", agent)).toBe(true);
    expect(ticketVisibleIn(makeTicket({ status: "open", userId: 9 }), "open", agent)).toBe(false);
    expect(ticketVisibleIn(makeTicket({ status: "closed", userId: 1 }), "closed", agent)).toBe(true);
    expect(ticketVisibleIn(makeTicket({ status: "bot" }), "bot", agent)).toBe(false);
  });

  it("shows supervisors everything, but only in the matching status tab", () => {
    expect(ticketVisibleIn(makeTicket({ status: "bot" }), "bot", supervisor)).toBe(true);
    expect(ticketVisibleIn(makeTicket({ status: "open", userId: 9 }), "open", supervisor)).toBe(true);
    expect(ticketVisibleIn(makeTicket({ status: "open" }), "pending", supervisor)).toBe(false);
  });
});

describe("matchesSearch", () => {
  it("matches the contact name case-insensitively or the number", () => {
    const ticket = makeTicket({ contact: makeContact({ name: "Maria Souza", number: "5511988887777" }) });
    expect(matchesSearch(ticket, "")).toBe(true);
    expect(matchesSearch(ticket, "maria")).toBe(true);
    expect(matchesSearch(ticket, "98888")).toBe(true);
    expect(matchesSearch(ticket, "joão")).toBe(false);
  });
});
