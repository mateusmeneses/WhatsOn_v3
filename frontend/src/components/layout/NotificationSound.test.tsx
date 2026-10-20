import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppRoutes } from "@/app/routes";
import { api } from "@/lib/api";
import * as sound from "@/lib/notifySound";
import { FakeSocket } from "@/test/fakeSocket";
import { renderWithProviders, setTestUser } from "@/test/utils";

describe("sound alert", () => {
  let summary = { pending: 1, mine: 0, unread: 0 };

  beforeEach(() => {
    localStorage.clear();
    summary = { pending: 1, mine: 0, unread: 0 };
    vi.spyOn(sound, "playChime").mockImplementation(() => undefined);
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/tickets/summary") return { data: { ...summary } };
      return { data: url === "/contacts" ? { items: [], hasMore: false } : [] };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("is off by default and toggles with the bell button, previewing the sound when turned on", async () => {
    setTestUser({ profile: "admin" });
    renderWithProviders(<AppRoutes />, { route: "/contatos", socket: new FakeSocket() });
    const toggle = await screen.findByRole("button", { name: "Ligar aviso sonoro" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);
    expect(sound.playChime).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Desligar aviso sonoro" })).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("whatson.sound")).toBe("1");
  });

  it("chimes only when waiting tickets or unread messages go up after the first load", async () => {
    sound.setSoundEnabled(true);
    setTestUser({ profile: "admin" });
    const socket = new FakeSocket();
    renderWithProviders(<AppRoutes />, { route: "/contatos", socket });
    await screen.findByRole("link", { name: "Atendimento, 1 aguardando" });
    expect(sound.playChime).not.toHaveBeenCalled(); // primeira leitura não conta

    summary = { pending: 2, mine: 0, unread: 3 };
    await act(async () => socket.serverEmit("ticket:update", { id: 1 }));
    await waitFor(() => expect(sound.playChime).toHaveBeenCalledTimes(1), { timeout: 4000 });

    summary = { pending: 1, mine: 0, unread: 0 }; // diminuiu: sem som
    await act(async () => socket.serverEmit("ticket:update", { id: 1 }));
    await screen.findByRole("link", { name: "Atendimento, 1 aguardando" }, { timeout: 4000 });
    expect(sound.playChime).toHaveBeenCalledTimes(1);
  });
});
