import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { fetchTicket, markTicketRead } from "@/features/tickets/ticketsApi";
import { fetchUserOptions } from "@/features/users/usersApi";
import { FakeSocket } from "@/test/fakeSocket";
import { makeMessage, makeTicket } from "@/test/factories";
import { renderWithProviders, setTestUser } from "@/test/utils";
import type { Message } from "@/types/api";
import { ChatPanel } from "./ChatPanel";
import { fetchMessages, sendMessage } from "./messagesApi";

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
  renderWithProviders(<ChatPanel ticketId={1} />, { socket });
  return { socket };
}

describe("ChatPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
