import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ManagerClientFields } from "./ManagerClientFields";

vi.mock("./managerApi", () => ({
  managerKeys: {
    clients: (...args: unknown[]) => ["mgr-clients", ...args],
    contacts: (...args: unknown[]) => ["mgr-contacts", ...args],
  },
  fetchManagerClients: vi.fn().mockResolvedValue([]),
  fetchManagerContacts: vi.fn().mockResolvedValue([]),
}));

describe("ManagerClientFields", () => {
  it("chama o campo de Solicitante (não Técnico)", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ManagerClientFields ticketId={1} value={{ codCliente: 10 }} onChange={() => {}} />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText("Solicitante")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Sem solicitante" })).toBeTruthy();
    expect(screen.queryByText("Técnico")).toBeNull();
  });
});
