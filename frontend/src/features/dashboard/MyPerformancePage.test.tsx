import { screen } from "@testing-library/react";
import { AppRoutes } from "@/app/routes";
import { api } from "@/lib/api";
import { renderWithProviders, setTestUser } from "@/test/utils";
import type { MyPerformance } from "./dashboardApi";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const m = (value: number, previous = 0) => ({ value, previous });
const now = new Date().toISOString();

function sample(): MyPerformance {
  return {
    range: { from: "2026-10-14", to: "2026-10-20", days: 7, timezone: "America/Sao_Paulo", generatedAt: now },
    live: { openNow: 2, pendingForMe: 1, waitingReply: 1 },
    kpis: {
      ticketsClosed: m(12, 8),
      ticketsAccepted: m(14, 10),
      messagesSent: m(120, 90),
      medianResponse: { value: 120, previous: 200 },
      avgResponse: { value: 180, previous: 240 },
      avgAcceptWait: { value: 60, previous: 90 },
      avgResolution: { value: 1800, previous: 2400 },
      responseWithinSla: { value: 80, previous: 70 },
      slaSeconds: 300,
    },
    team: { medianResponse: 240, avgClosedPerAgent: 9.5, agents: 4 },
    timeline: [{ date: "2026-10-20", closed: 3, accepted: 4, messages: 30 }],
    byQueue: [{ id: 1, name: "Suporte", color: "#0a6ad6", closed: 12 }],
    slowestResponses: [{ messageId: 1, ticketId: 5, contactName: "Cliente X", queueName: "Suporte", askedAt: now, answeredAt: now, seconds: 900 }],
    waitingNow: [{ ticketId: 6, contactName: "Cliente Y", queueName: "Suporte", queueColor: "#0a6ad6", since: now }],
  };
}

describe("MyPerformancePage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the logged user's numbers, the team comparison and is open to every profile", async () => {
    const get = vi.spyOn(api, "get").mockImplementation(async (url) => ({ data: url === "/dashboard/me" ? sample() : [] }));
    setTestUser({ profile: "agent", name: "Ana Atendente" });
    renderWithProviders(<AppRoutes />, { route: "/meu-desempenho" });

    expect(await screen.findByText("Finalizados por mim")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/dashboard/me", { params: { period: "7d" } });
    expect(screen.getByText("2 min")).toBeInTheDocument(); // mediana
    expect(screen.getByText("equipe: 4 min")).toBeInTheDocument();
    expect(screen.getByText(/Você responde 50% mais rápido/)).toBeInTheDocument();
    expect(screen.getByText("Cliente Y")).toBeInTheDocument();
    expect(screen.getByText("Cliente X")).toBeInTheDocument();
  });
});
