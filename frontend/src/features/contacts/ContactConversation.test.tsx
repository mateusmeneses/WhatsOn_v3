import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { Route, Routes } from "react-router-dom";
import { toast } from "sonner";
import { fetchConnections } from "@/features/connections/connectionsApi";
import { makeContact, makeTicket } from "@/test/factories";
import { renderWithProviders, setTestUser } from "@/test/utils";
import type { Connection } from "@/types/api";
import { ContactsPage } from "./ContactsPage";
import { fetchContacts, fetchContactStats, startConversation } from "./contactsApi";

vi.mock("./contactsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./contactsApi")>()),
  fetchContacts: vi.fn(),
  fetchContactStats: vi.fn(),
  startConversation: vi.fn(),
}));
vi.mock("@/features/connections/connectionsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/connections/connectionsApi")>()),
  fetchConnections: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function apiError(status: number, code: string, message: string) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError(code, "ERR", config, null, { status, statusText: "", headers: {}, config, data: { error: { code, message } } });
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/contatos" element={<ContactsPage />} />
      <Route path="/atendimento/:ticketId" element={<p>chat aberto</p>} />
    </Routes>,
    { route: "/contatos" },
  );
}

describe("ContactsPage: abrir conversa", () => {
  beforeEach(() => {
    setTestUser();
    vi.mocked(fetchContactStats).mockResolvedValue([]);
    vi.mocked(fetchContacts).mockResolvedValue({ items: [makeContact({ id: 7, name: "Maria" })], hasMore: false });
  });

  it("opens the contact's ticket in the chat", async () => {
    vi.mocked(startConversation).mockResolvedValue(makeTicket({ id: 42, status: "open" }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Conversar com Maria" }));
    expect(await screen.findByText("chat aberto")).toBeInTheDocument();
    expect(startConversation).toHaveBeenCalledWith(7, undefined);
  });

  it("asks which connection to use when the backend needs one", async () => {
    vi.mocked(fetchConnections).mockResolvedValue([
      { id: 1, name: "Suporte", status: "disconnected" } as Connection,
      { id: 2, name: "Comercial", status: "connected" } as Connection,
    ]);
    vi.mocked(startConversation)
      .mockRejectedValueOnce(apiError(400, "CONNECTION_REQUIRED", "Escolha"))
      .mockResolvedValueOnce(makeTicket({ id: 43, status: "open" }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Conversar com Maria" }));

    const dialog = await screen.findByRole("dialog", { name: "Conversar com Maria" });
    const select = await within(dialog).findByLabelText("Conexão");
    await waitFor(() => expect(select).toHaveValue("2"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Abrir conversa" }));

    expect(await screen.findByText("chat aberto")).toBeInTheDocument();
    expect(startConversation).toHaveBeenLastCalledWith(7, 2);
  });

  it("shows the backend message when the contact is with a colleague", async () => {
    vi.mocked(startConversation).mockRejectedValue(apiError(409, "TICKET_ACTIVE_EXISTS", "Já em atendimento com Yure"));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Conversar com Maria" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Já em atendimento com Yure"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
