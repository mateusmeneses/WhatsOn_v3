import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { fetchTicket, markTicketRead } from "@/features/tickets/ticketsApi";
import { fetchUserOptions } from "@/features/users/usersApi";
import { FakeSocket } from "@/test/fakeSocket";
import { makeMessage, makeTicket } from "@/test/factories";
import { renderWithProviders, setTestUser } from "@/test/utils";
import type { Message } from "@/types/api";
import { useLocalMessages } from "./localMessages";
import { ChatPanel } from "./ChatPanel";
import { deleteMessage, editMessage, fetchMessages, sendMessage, uploadMedia } from "./messagesApi";

vi.mock("@/features/tickets/ticketsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/tickets/ticketsApi")>()),
  fetchTicket: vi.fn(),
  markTicketRead: vi.fn(),
}));
vi.mock("@/features/users/usersApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/users/usersApi")>()),
  fetchUserOptions: vi.fn(),
}));
vi.mock("./messagesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./messagesApi")>()),
  fetchMessages: vi.fn(),
  sendMessage: vi.fn(),
  resendMessage: vi.fn(),
  uploadMedia: vi.fn(),
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function networkError() {
  return new AxiosError("Network Error", "ERR_NETWORK", { headers: new AxiosHeaders() });
}

function setup(ticketPartial = {}) {
  setTestUser({ id: 1, profile: "agent" });
  vi.mocked(fetchUserOptions).mockResolvedValue([{ id: 1, name: "Ana", queueIds: [10] }]);
  vi.mocked(fetchTicket).mockResolvedValue(makeTicket({ status: "open", userId: 1, ...ticketPartial }));
  vi.mocked(markTicketRead).mockResolvedValue(makeTicket({ status: "open", userId: 1 }));
  vi.mocked(fetchMessages).mockResolvedValue({ items: [makeMessage({ id: 1, body: "Bom dia" })], hasMore: false });
  const socket = new FakeSocket();
  const { queryClient } = renderWithProviders(<ChatPanel ticketId={1} />, { socket });
  return { socket, queryClient };
}

describe("ChatPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLocalMessages.setState({ byTicket: {} });
  });

  it("shows the conversation and joins the ticket room", async () => {
    const { socket } = setup();
    expect(await screen.findByText("Bom dia")).toBeInTheDocument();
    expect(screen.getByText("Maria Souza")).toBeInTheDocument();
    expect(socket.emitted.some((e) => e.event === "ticket:join" && e.args[0] === 1)).toBe(true);
  });

  it("shows the message right away and keeps a single bubble when the server confirms", async () => {
    const { socket } = setup();
    await screen.findByText("Bom dia");
    const pending = deferred<Message>();
    vi.mocked(sendMessage).mockReturnValue(pending.promise);

    await userEvent.type(screen.getByLabelText("Mensagem"), "Olá, tudo bem?{Enter}");
    expect(screen.getByText("Olá, tudo bem?")).toBeInTheDocument();
    expect(screen.getByLabelText("Enviando")).toBeInTheDocument();
    expect(screen.getByLabelText("Mensagem")).toHaveValue("");

    const real = makeMessage({ id: 50, fromMe: true, body: "Olá, tudo bem?", ack: "sent", sentByUserId: 1 });
    act(() => socket.serverEmit("message:new", real));
    await act(async () => pending.resolve(real));

    await waitFor(() => expect(screen.getAllByText("Olá, tudo bem?")).toHaveLength(1));
    expect(screen.getByLabelText("Enviada")).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledWith(1, { body: "Olá, tudo bem?" });
  });

  it("marks a failed send and lets the agent retry it", async () => {
    setup();
    await screen.findByText("Bom dia");
    vi.mocked(sendMessage).mockRejectedValueOnce(networkError());

    await userEvent.type(screen.getByLabelText("Mensagem"), "Teste{Enter}");
    expect(await screen.findByText("Não enviada")).toBeInTheDocument();

    vi.mocked(sendMessage).mockResolvedValueOnce(makeMessage({ id: 60, fromMe: true, body: "Teste", ack: "sent" }));
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

    await waitFor(() => expect(screen.queryByText("Não enviada")).not.toBeInTheDocument());
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText("Teste")).toHaveLength(1);
  });

  it("appends messages from the customer that arrive through the socket", async () => {
    const { socket } = setup();
    await screen.findByText("Bom dia");
    act(() => socket.serverEmit("message:new", makeMessage({ id: 2, body: "Preciso de ajuda" })));
    expect(await screen.findByText("Preciso de ajuda")).toBeInTheDocument();
  });

  it("hides the composer until the ticket is accepted", async () => {
    setup({ status: "pending", userId: null });
    expect(await screen.findByText("Aceite o atendimento para responder.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Mensagem")).not.toBeInTheDocument();
  });

  it("keeps a failed bubble after the messages query is refetched", async () => {
    const { queryClient } = setup();
    await screen.findByText("Bom dia");
    vi.mocked(sendMessage).mockRejectedValueOnce(networkError());
    await userEvent.type(screen.getByLabelText("Mensagem"), "Teste{Enter}");
    expect(await screen.findByText("Não enviada")).toBeInTheDocument();

    const callsBefore = vi.mocked(fetchMessages).mock.calls.length;
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    expect(vi.mocked(fetchMessages).mock.calls.length).toBeGreaterThan(callsBefore);
    expect(screen.getByText("Não enviada")).toBeInTheDocument();
    expect(screen.getByText("Teste")).toBeInTheDocument();
  });

  it("shows the temporary bubble when sending before the first page loads", async () => {
    setTestUser({ id: 1, profile: "agent" });
    vi.mocked(fetchUserOptions).mockResolvedValue([{ id: 1, name: "Ana", queueIds: [10] }]);
    vi.mocked(fetchTicket).mockResolvedValue(makeTicket({ status: "open", userId: 1 }));
    const first = deferred<{ items: Message[]; hasMore: boolean }>();
    vi.mocked(fetchMessages).mockReturnValue(first.promise);
    vi.mocked(sendMessage).mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<ChatPanel ticketId={1} />, { socket: new FakeSocket() });

    await userEvent.type(await screen.findByLabelText("Mensagem"), "Cedo{Enter}");
    expect(screen.getByText("Cedo")).toBeInTheDocument();
    await act(async () => first.resolve({ items: [makeMessage({ id: 1, body: "Bom dia" })], hasMore: false }));
    expect(await screen.findByText("Bom dia")).toBeInTheDocument();
    expect(screen.getByText("Cedo")).toBeInTheDocument();
  });

  it("shows the error and retries when the messages fail to load", async () => {
    setup();
    vi.mocked(fetchMessages).mockReset();
    vi.mocked(fetchMessages).mockRejectedValueOnce(networkError());
    vi.mocked(fetchMessages).mockResolvedValueOnce({ items: [makeMessage({ id: 1, body: "Bom dia" })], hasMore: false });

    expect(await screen.findByText("Sem conexão com o servidor. Verifique sua internet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(await screen.findByText("Bom dia")).toBeInTheDocument();
    expect(fetchMessages).toHaveBeenCalledTimes(2);
  });

  describe("edit and delete", () => {
    const recent = () => new Date(Date.now() - 60_000).toISOString();

    function setupWith(message: Message, ticketPartial = {}) {
      const ctx = setup(ticketPartial);
      vi.mocked(fetchMessages).mockResolvedValue({ items: [message], hasMore: false });
      return ctx;
    }

    it("edits a recent sent text message", async () => {
      const own = makeMessage({ id: 7, fromMe: true, body: "Bom dai", ack: "delivered", createdAt: recent() });
      setupWith(own);
      await screen.findByText("Bom dai");
      vi.mocked(editMessage).mockResolvedValue({ ...own, body: "Bom dia", editedAt: new Date().toISOString() });

      await userEvent.click(screen.getByRole("button", { name: "Editar mensagem" }));
      const box = screen.getByRole("textbox", { name: "Editar mensagem" });
      await userEvent.clear(box);
      await userEvent.type(box, "Bom dia{Enter}");

      expect(editMessage).toHaveBeenCalledWith(7, "Bom dia");
      expect(await screen.findByText("Bom dia")).toBeInTheDocument();
      expect(screen.getByText("editada")).toBeInTheDocument();
    });

    it("hides edit for old messages and customer messages", async () => {
      const old = makeMessage({ id: 8, fromMe: true, body: "Antiga", createdAt: new Date(Date.now() - 20 * 60_000).toISOString() });
      setupWith(old);
      await screen.findByText("Antiga");
      expect(screen.queryByRole("button", { name: "Editar mensagem" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Apagar mensagem" })).toBeInTheDocument();
    });

    it("deletes a message for everyone after confirming", async () => {
      const own = makeMessage({ id: 9, fromMe: true, body: "Errada", createdAt: recent() });
      setupWith(own);
      await screen.findByText("Errada");
      vi.mocked(deleteMessage).mockResolvedValue({ ...own, deletedAt: new Date().toISOString() });

      await userEvent.click(screen.getByRole("button", { name: "Apagar mensagem" }));
      await userEvent.click(await screen.findByRole("button", { name: "Apagar" }));

      await waitFor(() => expect(deleteMessage).toHaveBeenCalledWith(9));
      expect(await screen.findByText("Você apagou esta mensagem")).toBeInTheDocument();
      expect(screen.queryByText("Errada")).not.toBeInTheDocument();
    });

    it("offers no actions when the agent cannot reply", async () => {
      const own = makeMessage({ id: 10, fromMe: true, body: "Minha", createdAt: recent() });
      setupWith(own, { status: "closed" });
      await screen.findByText("Minha");
      expect(screen.queryByRole("button", { name: "Apagar mensagem" })).not.toBeInTheDocument();
    });
  });

  describe("audio", () => {
    class FakeRecorder {
      static isTypeSupported = (type: string) => type.startsWith("audio/webm");
      mimeType = "audio/webm;codecs=opus";
      state = "inactive";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["voz"], { type: "audio/webm" }) });
        this.onstop?.();
      }
    }
    const stopTrack = vi.fn();

    beforeEach(() => {
      vi.stubGlobal("MediaRecorder", FakeRecorder);
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) },
      });
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    });

    it("records and sends a voice message", async () => {
      setup();
      await screen.findByText("Bom dia");
      const media = { url: "/media/1/a.webm", mime: "audio/webm", name: "audio.webm" };
      vi.mocked(uploadMedia).mockResolvedValue(media);
      vi.mocked(sendMessage).mockReturnValue(new Promise(() => undefined));

      await userEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
      expect(screen.getByText(/Gravando áudio/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Enviar áudio" }));

      await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(1, { media }));
      const file = vi.mocked(uploadMedia).mock.calls[0]![0];
      expect(file.type).toBe("audio/webm");
      expect(stopTrack).toHaveBeenCalled();
    });

    it("discards a recording without uploading", async () => {
      setup();
      await screen.findByText("Bom dia");
      await userEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
      await userEvent.click(screen.getByRole("button", { name: "Descartar áudio" }));
      expect(uploadMedia).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Mensagem")).toBeInTheDocument();
    });

    it("shows the send button once there is text", async () => {
      setup();
      await screen.findByText("Bom dia");
      await userEvent.type(screen.getByLabelText("Mensagem"), "oi");
      expect(screen.queryByRole("button", { name: "Gravar áudio" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Enviar" })).toBeEnabled();
    });
  });
});
