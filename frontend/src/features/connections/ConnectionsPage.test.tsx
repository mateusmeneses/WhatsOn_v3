import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Socket } from "socket.io-client";
import { toast } from "sonner";
import { fetchQueues } from "@/features/queues/queuesApi";
import { RealtimeContext } from "@/realtime/RealtimeProvider";
import { FakeSocket } from "@/test/fakeSocket";
import { renderWithProviders, setTestUser } from "@/test/utils";
import type { Connection } from "@/types/api";
import { ConnectionAlerts } from "./ConnectionAlerts";
import { ConnectionsPage } from "./ConnectionsPage";
import { createConnection, disconnectConnection, fetchConnections, fetchQrCode } from "./connectionsApi";

vi.mock("./connectionsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./connectionsApi")>()),
  fetchConnections: vi.fn(),
  createConnection: vi.fn(),
  updateConnection: vi.fn(),
  deleteConnection: vi.fn(),
  fetchQrCode: vi.fn(),
  disconnectConnection: vi.fn(),
}));
vi.mock("@/features/queues/queuesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/queues/queuesApi")>()),
  fetchQueues: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const conn = (partial: Partial<Connection>): Connection => ({
  id: 1,
  companyId: 1,
  name: "Principal",
  instanceName: "wo_1_abc",
  status: "connected",
  number: "5511999990000",
  isDefault: true,
  defaultQueueId: 10,
  outOfHoursMessage: "Fora do horário",
  closingMessage: "",
  transferMessage: "Aguarde",
  botTimeoutMinutes: 30,
  ...partial,
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  setTestUser({ profile: "admin" });
  vi.mocked(fetchQueues).mockResolvedValue([{ id: 10, companyId: 1, name: "Suporte", color: "#6d5dfc", schedule: {} }]);
  vi.mocked(fetchConnections).mockResolvedValue([
    conn({ id: 1, name: "Principal", status: "connected" }),
    conn({ id: 2, name: "Vendas", status: "disconnected", isDefault: false, number: null }),
  ]);
});

describe("ConnectionsPage", () => {
  it("lists connections with their status", async () => {
    renderWithProviders(<ConnectionsPage />, { socket: new FakeSocket() });
    const principal = (await screen.findByText("Principal")).closest("article")!;
    expect(within(principal).getByText("Conectado")).toBeInTheDocument();
    const vendas = screen.getByText("Vendas").closest("article")!;
    expect(within(vendas).getByText("Desconectado")).toBeInTheDocument();
  });

  it("creates a connection and shows its QR code, closing when WhatsApp connects", async () => {
    const socket = new FakeSocket();
    const created = conn({ id: 3, name: "Comercial", status: "qrcode", isDefault: false, number: null });
    vi.mocked(createConnection).mockResolvedValue(created);
    vi.mocked(fetchQrCode).mockResolvedValue({ qr: "data:image/png;base64,QR1" });
    renderWithProviders(<ConnectionsPage />, { socket });
    await screen.findByText("Principal");

    await userEvent.click(screen.getByRole("button", { name: "Nova conexão" }));
    const dialog = screen.getByRole("dialog", { name: "Nova conexão" });
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Comercial");
    vi.mocked(fetchConnections).mockResolvedValue([conn({ id: 1 }), created]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(createConnection).toHaveBeenCalledWith(expect.objectContaining({ name: "Comercial" })));
    const qrDialog = await screen.findByRole("dialog", { name: "Conectar Comercial" });
    expect(await within(qrDialog).findByAltText("QR code do WhatsApp")).toHaveAttribute("src", "data:image/png;base64,QR1");

    act(() => socket.serverEmit("connection:qrcode", { connectionId: 3, qr: "data:image/png;base64,QR2" }));
    expect(within(qrDialog).getByAltText("QR code do WhatsApp")).toHaveAttribute("src", "data:image/png;base64,QR2");

    act(() => socket.serverEmit("connection:update", { ...created, status: "connected", number: "5511911112222" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conectar Comercial" })).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith("WhatsApp conectado");
  });

  it("disconnects after confirmation", async () => {
    vi.mocked(disconnectConnection).mockResolvedValue(conn({ status: "disconnected" }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<ConnectionsPage />, { socket: new FakeSocket() });
    await userEvent.click(await screen.findByRole("button", { name: "Desconectar Principal" }));
    await waitFor(() => expect(disconnectConnection).toHaveBeenCalledWith(1));
  });
});

describe("ConnectionAlerts", () => {
  it("warns when a connection drops", () => {
    const socket = new FakeSocket();
    render(
      <RealtimeContext.Provider value={{ socket: socket as unknown as Socket, epoch: 1 }}>
        <ConnectionAlerts />
      </RealtimeContext.Provider>,
    );
    act(() => socket.serverEmit("connection:alert", { connectionId: 1, name: "Principal" }));
    expect(toast.error).toHaveBeenCalledWith('A conexão "Principal" caiu. Gere um novo QR code para reconectar.');
  });
});
