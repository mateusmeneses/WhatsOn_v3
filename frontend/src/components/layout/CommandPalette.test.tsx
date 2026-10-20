import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { fetchTickets } from "@/features/tickets/ticketsApi";
import { makeContact, makeTicket } from "@/test/factories";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { CommandPalette } from "./CommandPalette";

vi.mock("@/features/tickets/ticketsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/tickets/ticketsApi")>()),
  fetchTickets: vi.fn(),
}));

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function setup(profile: "admin" | "agent" = "admin") {
  setTestUser({ profile });
  return renderWithProviders(
    <>
      <CommandPalette />
      <Where />
    </>,
  );
}

describe("CommandPalette", () => {
  beforeEach(() => {
    vi.mocked(fetchTickets).mockImplementation(async (status) =>
      status === "open"
        ? { items: [makeTicket({ id: 42, status: "open", lastMessage: "Quero a segunda via", contact: makeContact({ name: "Maria Souza", number: "5511988887777" }) })], hasMore: false }
        : { items: [], hasMore: false },
    );
  });

  it("opens with Ctrl+K and finds pages ignoring accents", async () => {
    setup();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await userEvent.keyboard("{Control>}k{/Control}");
    const input = await screen.findByRole("combobox", { name: "Buscar páginas e conversas" });
    await userEvent.type(input, "configuracoes");
    expect(await screen.findByRole("option", { name: /Configurações/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Contatos/ })).not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/configuracoes"));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("searches conversations by customer and opens the chosen one with the keyboard", async () => {
    setup();
    await userEvent.keyboard("{Control>}k{/Control}");
    await userEvent.type(await screen.findByRole("combobox"), "maria");
    const option = await screen.findByRole("option", { name: /Maria Souza/ });
    expect(option).toHaveTextContent("Em atendimento");
    expect(fetchTickets).toHaveBeenCalledWith("pending", "maria", 1);
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/atendimento/42"));
  });

  it("shows one result per customer, preferring the ticket in progress", async () => {
    const maria = makeContact({ id: 1, name: "Maria Souza" });
    vi.mocked(fetchTickets).mockImplementation(async (status) => ({
      hasMore: false,
      items:
        status === "closed"
          ? [makeTicket({ id: 1, contactId: 1, status: "closed", lastMessageAt: "2026-10-19T10:00:00Z", contact: maria }), makeTicket({ id: 2, contactId: 1, status: "closed", lastMessageAt: "2026-10-18T10:00:00Z", contact: maria })]
          : status === "open"
            ? [makeTicket({ id: 3, contactId: 1, status: "open", lastMessageAt: "2026-10-10T10:00:00Z", contact: maria })]
            : [],
    }));
    setup();
    await userEvent.keyboard("{Control>}k{/Control}");
    await userEvent.type(await screen.findByRole("combobox"), "maria");
    const options = await screen.findAllByRole("option", { name: /Maria Souza/ });
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Em atendimento");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/atendimento/3"));
  });

  it("only offers the pages the profile can open, and explains empty searches", async () => {
    setup("agent");
    await userEvent.keyboard("{Control>}k{/Control}");
    const input = await screen.findByRole("combobox");
    expect(screen.queryByRole("option", { name: /Configurações/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Atendimento/ })).toBeInTheDocument();
    vi.mocked(fetchTickets).mockResolvedValue({ items: [], hasMore: false });
    await userEvent.type(input, "zzzzz");
    expect(await screen.findByText("Nada encontrado para essa busca.")).toBeInTheDocument();
  });
});
