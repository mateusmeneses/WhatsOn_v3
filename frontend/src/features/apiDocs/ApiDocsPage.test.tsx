import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fetchApiToken, fetchConnections } from "@/features/connections/connectionsApi";
import { renderWithProviders, setTestUser } from "@/test/utils";
import type { Connection } from "@/types/api";
import { ApiDocsPage } from "./ApiDocsPage";
import { buildSample, LANGUAGES } from "./codeSamples";
import { endpointById, ENDPOINTS, examplePayload } from "./endpoints";
import { runRequest } from "./externalApiClient";

vi.mock("@/features/connections/connectionsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/connections/connectionsApi")>()),
  fetchConnections: vi.fn(),
  fetchApiToken: vi.fn(),
}));
vi.mock("./externalApiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./externalApiClient")>()),
  runRequest: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const connection: Connection = {
  id: 7,
  companyId: 1,
  name: "ERP",
  instanceName: "wo_1_abc",
  status: "connected",
  number: "5511999990000",
  isDefault: true,
  defaultQueueId: null,
  outOfHoursMessage: "",
  closingMessage: "",
  transferMessage: "",
  botTimeoutMinutes: 30,
  hasApiToken: true,
};

beforeEach(() => {
  setTestUser({ profile: "admin" });
  vi.mocked(fetchConnections).mockResolvedValue([connection]);
  vi.mocked(fetchApiToken).mockResolvedValue({ apiToken: "tok-erp" });
});

afterEach(() => vi.clearAllMocks());

describe("ApiDocsPage", () => {
  it("shows the manual with the base URL and the error table", () => {
    renderWithProviders(<ApiDocsPage />);
    expect(screen.getByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
    expect(screen.getAllByText(/\/api\/v1$/).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Erros e quando repetir" })).toBeInTheDocument();
    expect(screen.getByText("NUMBER_NOT_ON_WHATSAPP")).toBeInTheDocument();
  });

  it("lists every route and opens the console on the chosen one", async () => {
    renderWithProviders(<ApiDocsPage />);
    await userEvent.click(screen.getByRole("tab", { name: "Rotas" }));
    for (const e of ENDPOINTS) expect(screen.getByRole("heading", { name: `${e.method} ${e.path}` })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Testar Enviar mensagem" }));
    expect(screen.getByLabelText("Rota")).toHaveValue("send");
    expect(screen.getByLabelText("number *")).toHaveValue("5511988887777");
  });

  it("sends a request from the console with the connection token", async () => {
    vi.mocked(runRequest).mockResolvedValue({
      status: 201,
      durationMs: 42,
      headers: { "x-ratelimit-remaining": "59" },
      body: { ticketId: 1, messages: [{ id: 9, type: "text", ack: "pending" }] },
    });
    renderWithProviders(<ApiDocsPage />);
    await userEvent.click(screen.getByRole("tab", { name: "Console de testes" }));
    await screen.findByTestId("console-token");
    await userEvent.selectOptions(screen.getByLabelText("Rota"), "send");
    const bodyField = screen.getByLabelText("body");
    await userEvent.clear(bodyField);
    await userEvent.type(bodyField, "Teste do ERP");
    await userEvent.click(screen.getByRole("button", { name: "Enviar requisição" }));

    await waitFor(() =>
      expect(runRequest).toHaveBeenCalledWith(
        endpointById("send"),
        "tok-erp",
        { number: "5511988887777", body: "Teste do ERP" },
        [],
      ),
    );
    const result = await screen.findByTestId("console-result");
    expect(within(result).getByText("HTTP 201")).toBeInTheDocument();
    expect(within(result).getByText("x-ratelimit-remaining: 59")).toBeInTheDocument();
    expect(fetchApiToken).toHaveBeenCalledWith(7);
  });

  it("asks for confirmation before logging out the number", async () => {
    vi.mocked(runRequest).mockResolvedValue({ status: 200, durationMs: 5, headers: {}, body: { status: "disconnected" } });
    renderWithProviders(<ApiDocsPage />);
    await userEvent.click(screen.getByRole("tab", { name: "Console de testes" }));
    await screen.findByTestId("console-token");
    await userEvent.selectOptions(screen.getByLabelText("Rota"), "logout");
    await userEvent.click(screen.getByRole("button", { name: "Enviar requisição" }));
    expect(runRequest).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: "Desconectar" }));
    await waitFor(() => expect(runRequest).toHaveBeenCalledTimes(1));
  });

  it("generates code samples in every language", async () => {
    renderWithProviders(<ApiDocsPage />);
    await userEvent.click(screen.getByRole("tab", { name: "Exemplos de código" }));
    await userEvent.click(screen.getByRole("tab", { name: "Python" }));
    expect(screen.getByText(/import requests/)).toBeInTheDocument();
  });
});

describe("buildSample", () => {
  const input = { baseUrl: "https://x.test/api/v1", token: "T", payload: examplePayload(endpointById("send")) };

  it.each(LANGUAGES.map((l) => l.value))("%s puts the token and the route in every sample", (language) => {
    for (const e of ENDPOINTS) {
      const code = buildSample(language, e, { ...input, payload: examplePayload(e) });
      expect(code).toContain(e.path.slice(1));
      expect(code).toContain("T");
    }
    const multipart = buildSample(language, endpointById("send"), { ...input, withFile: true });
    expect(multipart).toContain("medias");
  });

  it("builds a valid curl for JSON and multipart", () => {
    expect(buildSample("curl", endpointById("send"), input)).toBe(
      [
        'curl -X POST "https://x.test/api/v1/messages/send"',
        '  -H "Authorization: Bearer T"',
        '  -H "Content-Type: application/json"',
        `  -d '{"number":"5511988887777","body":"Olá! Seu pedido 1234 saiu para entrega."}'`,
      ].join(" \\\n"),
    );
    expect(buildSample("curl", endpointById("send"), { ...input, withFile: true })).toContain('-F "medias=@boleto.pdf"');
  });
});
