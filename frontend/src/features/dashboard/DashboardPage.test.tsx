import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppRoutes } from "@/app/routes";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { api } from "@/lib/api";
import type { DashboardData } from "./dashboardApi";
import { DashboardPage } from "./DashboardPage";
import { dashboardToCsv } from "./exportCsv";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const m = (value: number, previous = 0) => ({ value, previous });

function sample(overrides: Partial<DashboardData> = {}): DashboardData {
  const now = new Date().toISOString();
  return {
    range: { from: "2026-10-14", to: "2026-10-20", days: 7, timezone: "America/Sao_Paulo", generatedAt: now },
    live: { bot: 1, pending: 2, open: 3, closedToday: 4, waitingReply: 2, oldestPendingSince: now, onlineUsers: 1 },
    kpis: {
      ticketsCreated: m(40, 20),
      ticketsClosed: m(35, 35),
      messagesIn: m(300, 150),
      messagesOut: m(280, 140),
      messagesBot: m(50, 25),
      avgResolution: { value: 4000, previous: 5000 },
      medianResponse: { value: 235, previous: 300 },
      avgResponse: { value: 400, previous: 500 },
      avgAcceptWait: { value: 90, previous: null },
      responseWithinSla: { value: 72.4, previous: 60 },
      slaSeconds: 300,
    },
    timeline: [
      { date: "2026-10-19", created: 5, closed: 4, inbound: 40, outbound: 30, bot: 5 },
      { date: "2026-10-20", created: 7, closed: 6, inbound: 50, outbound: 45, bot: 8 },
    ],
    movementTimeline: [],
    heatmap: [{ weekday: 2, hour: 10, count: 12 }],
    movement: { accepted: 30, transferred: 5, claimed: 1, reopened: 2, botTimeout: 3, closed: 35 },
    bot: { handled: 20, resolvedByBot: 5, timeouts: 3 },
    byQueue: [{ id: 1, name: "Suporte", color: "#0a6ad6", created: 25, closed: 20, waiting: 2, avgResolution: 3000 }],
    byConnection: [{ id: 1, name: "Principal", number: "5511987654321", status: "connected", tickets: 40, messagesIn: 300 }],
    messageTypes: [{ type: "text", count: 500 }],
    agents: [
      { id: 2, name: "Rafael Lima", profile: "agent", online: true, connectedSince: now, lastLoginAt: now, lastSeenAt: now, openNow: 2, accepted: 15, closed: 14, messagesSent: 120, avgResponse: 180, avgAcceptWait: 60 },
      { id: 3, name: "Juliana Alves", profile: "agent", online: false, connectedSince: null, lastLoginAt: null, lastSeenAt: null, openNow: 0, accepted: 3, closed: 3, messagesSent: 20, avgResponse: null, avgAcceptWait: null },
    ],
    topContacts: [{ id: 9, name: "Academia Forma", number: "5511980001111", tickets: 4, inbound: 30, outbound: 28, lastAt: now }],
    slowestResponses: [{ messageId: 1, ticketId: 77, contactName: "Cliente Lento", agentName: "Rafael Lima", queueName: "Suporte", askedAt: now, answeredAt: now, seconds: 3900 }],
    waitingNow: [{ ticketId: 78, contactName: "Cliente Impaciente", status: "pending", agentName: null, queueName: "Suporte", queueColor: "#0a6ad6", since: now }],
    recentActivity: [{ id: 1, event: "accepted", createdAt: now, ticketId: 77, contactName: "Cliente Lento", userName: "Rafael Lima", toUserName: null, queueName: null }],
    ...overrides,
  };
}

describe("DashboardPage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows live counters, KPIs, team presence and the slowest answers", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: sample() });
    setTestUser({ profile: "admin" });
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText("Online agora")).toBeInTheDocument();
    expect(screen.getByText("Atendimentos criados")).toBeInTheDocument();
    expect(screen.getByText("3 min 55 s")).toBeInTheDocument(); // mediana de resposta
    expect(screen.getByText("72")).toBeInTheDocument(); // % no prazo

    const team = screen.getByRole("heading", { name: "Equipe e presença" }).closest("section")!;
    expect(within(team).getByText("1 de 2 online")).toBeInTheDocument();
    const row = within(team).getByText("Rafael Lima").closest("tr")!;
    expect(within(row).getByRole("img", { name: "Online" })).toBeInTheDocument();
    expect(within(team).getByText("Nunca acessou")).toBeInTheDocument();

    expect(screen.getByText("Cliente Lento", { selector: "span.truncate" })).toBeInTheDocument();
    expect(screen.getByText("1 h 5 min")).toBeInTheDocument();
    expect(screen.getByText("Academia Forma")).toBeInTheDocument();
  });

  it("lets the daily charts be read as a table", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: sample() });
    setTestUser({ profile: "admin" });
    renderWithProviders(<DashboardPage />);
    const panel = (await screen.findByRole("heading", { name: "Atendimentos por dia" })).closest("section")!;
    expect(within(panel).queryByRole("table")).not.toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Ver tabela" }));
    const table = within(panel).getByRole("table", { name: "Atendimentos criados e finalizados por dia" });
    expect(within(table).getByText("20/10/2026")).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(3); // cabeçalho + 2 dias
    await userEvent.click(within(panel).getByRole("button", { name: "Ver gráfico" }));
    expect(within(panel).queryByRole("table")).not.toBeInTheDocument();
  });

  it("changes the period and queries again", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: sample() });
    setTestUser({ profile: "supervisor" });
    renderWithProviders(<DashboardPage />);
    await screen.findByText("Online agora");
    expect(api.get).toHaveBeenLastCalledWith("/dashboard", { params: { period: "7d" } });

    await userEvent.click(screen.getByRole("tab", { name: "30 dias" }));
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith("/dashboard", { params: { period: "30d" } }));
  });

  it("shows an error with retry when the request fails", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("falhou"));
    setTestUser({ profile: "admin" });
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar o dashboard");
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
  });

  it("is reachable only by admins and supervisors", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: sample() });
    setTestUser({ profile: "agent" });
    renderWithProviders(<AppRoutes />, { route: "/dashboard" });
    // Atendente é mandado de volta para o atendimento.
    expect(await screen.findByText("Atendimentos")).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith("/dashboard", expect.anything());
  });
});

describe("dashboardToCsv", () => {
  it("exports blocks separated by semicolons with BOM", () => {
    const csv = dashboardToCsv(sample());
    expect(csv.startsWith("﻿Resumo do período")).toBe(true);
    expect(csv).toContain("Atendimentos criados;40;20");
    expect(csv).toContain("Rafael Lima;agent;sim;2;15;14;120;3 min;1 min");
    expect(csv).toContain("Juliana Alves;agent;não;0;3;3;20;—;—");
  });
});
