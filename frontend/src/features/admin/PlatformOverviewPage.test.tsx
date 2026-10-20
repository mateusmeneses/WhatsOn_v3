import { screen, within } from "@testing-library/react";
import { AppRoutes } from "@/app/routes";
import { api } from "@/lib/api";
import { renderWithProviders, setTestUser } from "@/test/utils";
import type { PlatformOverview } from "./platformApi";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const m = (value: number, previous = 0) => ({ value, previous });

function sample(): PlatformOverview {
  return {
    range: { from: "2026-09-21", to: "2026-10-20", days: 30, timezone: "America/Sao_Paulo", generatedAt: new Date().toISOString() },
    totals: { companies: 3, activeCompanies: 2, blockedCompanies: 1, users: 9, onlineUsers: 2, partners: 1, connections: { connected: 2, qrcode: 1, disconnected: 0 } },
    kpis: { newCompanies: m(1, 0), ticketsCreated: m(50, 25), ticketsClosed: m(40, 20), messagesIn: m(400, 200), messagesOut: m(380, 190), activeCompaniesWithTraffic: m(1, 1) },
    timeline: [{ date: "2026-10-20", tickets: 5, messages: 40, newCompanies: 0 }],
    companies: [
      { id: 1, name: "Loja A", status: "active", partner: "ERP Parceiro", createdAt: "2026-01-10T12:00:00Z", users: 5, onlineUsers: 2, connectionsConnected: 1, connections: 2, tickets: 50, messages: 780, lastActivityAt: new Date().toISOString() },
      { id: 2, name: "Loja B", status: "active", partner: null, createdAt: "2026-02-10T12:00:00Z", users: 2, onlineUsers: 0, connectionsConnected: 1, connections: 1, tickets: 0, messages: 0, lastActivityAt: null },
      { id: 3, name: "Loja C", status: "blocked", partner: null, createdAt: "2026-03-10T12:00:00Z", users: 2, onlineUsers: 0, connectionsConnected: 0, connections: 0, tickets: 0, messages: 0, lastActivityAt: null },
    ],
    partners: [{ id: 1, name: "ERP Parceiro", status: "active", companies: 1, tickets: 50, lastUsedAt: null }],
  };
}

describe("PlatformOverviewPage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows platform totals, flags idle and blocked companies", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: sample() });
    setTestUser({ profile: "superadmin", superAdmin: true, companyId: null });
    renderWithProviders(<AppRoutes />, { route: "/visao-geral" });

    expect(await screen.findByText("Empresas ativas")).toBeInTheDocument();
    const table = screen.getByRole("heading", { name: "Empresas" }).closest("section")!;
    const rowB = within(table).getByText("Loja B").closest("tr")!;
    expect(within(rowB).getByText("Sem movimento")).toBeInTheDocument();
    const rowC = within(table).getByText("Loja C").closest("tr")!;
    expect(within(rowC).getByText("Bloqueada")).toBeInTheDocument();
    expect(within(table).getByText("2/5")).toBeInTheDocument(); // online / usuários da Loja A
    expect(screen.getByText("ERP Parceiro", { selector: "span.truncate" })).toBeInTheDocument();
  });

  it("does not open for regular users", async () => {
    const get = vi.spyOn(api, "get").mockImplementation(async () => ({ data: [] }));
    setTestUser({ profile: "admin" });
    renderWithProviders(<AppRoutes />, { route: "/visao-geral" });
    expect(await screen.findByText("Atendimentos")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith("/admin/overview", expect.anything());
  });
});
