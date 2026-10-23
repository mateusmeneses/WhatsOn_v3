import { act, screen } from "@testing-library/react";
import { io } from "socket.io-client";
import { toast } from "sonner";
import { AppRoutes } from "@/app/routes";
import { api } from "@/lib/api";
import * as sound from "@/lib/notifySound";
import type { FakeSocket } from "@/test/fakeSocket";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { idleAlertText } from "./IdleAlerts";

describe("idle ticket alert", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(sound, "playAlarm").mockImplementation(() => undefined);
    vi.spyOn(toast, "warning");
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/tickets/summary") return { data: { pending: 0, mine: 0, unread: 0 } };
      return { data: url === "/contacts" ? { items: [], hasMore: false } : [] };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("sounds the alarm even with the chime off and shows a persistent warning that opens the ticket", async () => {
    setTestUser({ profile: "agent" });
    vi.mocked(io).mockClear();
    renderWithProviders(<AppRoutes />, { route: "/contatos" });
    await screen.findByRole("link", { name: /Atendimento/ });
    const socket = vi.mocked(io).mock.results.at(-1)!.value as FakeSocket;
    act(() => socket.serverEmit("ready"));

    await act(async () =>
      socket.serverEmit("ticket:idle-alert", { ticketId: 42, contactName: "Maria", agentName: "João", minutes: 31, level: 2, escalated: false }),
    );
    expect(sound.playAlarm).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith(
      "Cliente sem resposta",
      expect.objectContaining({ description: "Maria está há 31 min esperando sua resposta (#42).", duration: Infinity }),
    );
  });

  it("words the text by stage and for supervisors", () => {
    const base = { ticketId: 7, contactName: "Ana", agentName: "Bia", minutes: 60, level: 4 };
    expect(idleAlertText({ ...base, level: 3, escalated: false }).title).toBe("URGENTE: cliente sem resposta");
    expect(idleAlertText({ ...base, escalated: true })).toEqual({
      title: "Atendimento sem resposta",
      body: "Ana está há 60 min sem resposta com Bia (#7).",
    });
  });
});
