import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, setTestUser } from "@/test/utils";
import type { AdminCompany, AdminPartner } from "@/types/api";
import {
  createPartner,
  fetchCompanies,
  fetchPartners,
  regeneratePartnerKey,
  setPartnerRevoked,
  updateCompany,
} from "./adminApi";
import { CompaniesPage } from "./CompaniesPage";
import { PartnersPage } from "./PartnersPage";

vi.mock("./adminApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./adminApi")>()),
  fetchPartners: vi.fn(),
  createPartner: vi.fn(),
  updatePartner: vi.fn(),
  regeneratePartnerKey: vi.fn(),
  setPartnerRevoked: vi.fn(),
  fetchCompanies: vi.fn(),
  updateCompany: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const KEY = `wpk_${"a1".repeat(24)}`;

const partner = (partial: Partial<AdminPartner> = {}): AdminPartner => ({
  id: 1,
  name: "MultiComércio",
  keyPrefix: "wpk_3f9a0c1d",
  status: "active",
  lastUsedAt: null,
  createdAt: "2026-10-19T12:00:00.000Z",
  companyCount: 4,
  ...partial,
});

const superAdmin = () => setTestUser({ id: 99, companyId: null, profile: "superadmin", superAdmin: true, name: "Root" });

beforeEach(() => {
  vi.mocked(fetchPartners).mockResolvedValue([partner(), partner({ id: 2, name: "ERP Beta", status: "revoked", companyCount: 0 })]);
});

describe("PartnersPage", () => {
  it("lists partners with key prefix, status and company count", async () => {
    superAdmin();
    renderWithProviders(<PartnersPage />);
    const row = (await screen.findByText("MultiComércio")).closest<HTMLElement>('[role="row"]')!;
    expect(within(row).getByText("wpk_3f9a0c1d…")).toBeInTheDocument();
    expect(within(row).getByText("Ativo")).toBeInTheDocument();
    expect(within(row).getByText("4")).toBeInTheDocument();
    const beta = screen.getByText("ERP Beta").closest<HTMLElement>('[role="row"]')!;
    expect(within(beta).getByText("Revogado")).toBeInTheDocument();
    expect(within(beta).getByRole("button", { name: "Reativar ERP Beta" })).toBeInTheDocument();
  });

  it("creates a partner and shows the key once", async () => {
    superAdmin();
    vi.mocked(createPartner).mockResolvedValue({ partner: partner({ id: 3, name: "Novo ERP" }), key: KEY });
    renderWithProviders(<PartnersPage />);
    await screen.findByText("MultiComércio");

    await userEvent.click(screen.getByRole("button", { name: "Novo parceiro" }));
    const dialog = screen.getByRole("dialog", { name: "Novo parceiro" });
    await userEvent.type(within(dialog).getByLabelText("Nome do sistema"), "Novo ERP");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(createPartner).toHaveBeenCalledWith("Novo ERP"));
    expect(await screen.findByTestId("partner-key")).toHaveTextContent(KEY);
    expect(screen.getByText(/não será mostrada de novo/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Já guardei" }));
    expect(screen.queryByTestId("partner-key")).not.toBeInTheDocument();
  });

  it("regenerates the key after confirmation and shows the new one", async () => {
    superAdmin();
    vi.mocked(regeneratePartnerKey).mockResolvedValue({ partner: partner(), key: KEY });
    renderWithProviders(<PartnersPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Regenerar chave de MultiComércio" }));
    const confirm = screen.getByRole("dialog", { name: "Regenerar chave" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Regenerar" }));
    await waitFor(() => expect(regeneratePartnerKey).toHaveBeenCalledWith(1));
    expect(await screen.findByTestId("partner-key")).toHaveTextContent(KEY);
  });

  it("revokes a partner after confirmation", async () => {
    superAdmin();
    vi.mocked(setPartnerRevoked).mockResolvedValue(partner({ status: "revoked" }));
    renderWithProviders(<PartnersPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Revogar MultiComércio" }));
    const confirm = screen.getByRole("dialog", { name: "Revogar parceiro" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Revogar" }));
    await waitFor(() => expect(setPartnerRevoked).toHaveBeenCalledWith(1, true));
  });
});

describe("CompaniesPage with CNPJ", () => {
  const company = (partial: Partial<AdminCompany> = {}): AdminCompany => ({
    id: 5,
    name: "Loja Alfa",
    status: "active",
    timezone: "America/Sao_Paulo",
    createdAt: "2026-10-01T12:00:00.000Z",
    userCount: 0,
    cnpj: "12345678000195",
    partner: { id: 1, name: "MultiComércio" },
    ...partial,
  });

  it("shows the formatted CNPJ and the partner", async () => {
    superAdmin();
    vi.mocked(fetchCompanies).mockResolvedValue([company()]);
    renderWithProviders(<CompaniesPage />);
    expect(await screen.findByText("12.345.678/0001-95 · via MultiComércio")).toBeInTheDocument();
  });

  it("edits the CNPJ and clears it when emptied", async () => {
    superAdmin();
    vi.mocked(fetchCompanies).mockResolvedValue([company()]);
    vi.mocked(updateCompany).mockResolvedValue(company());
    renderWithProviders(<CompaniesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Editar Loja Alfa" }));
    const dialog = screen.getByRole("dialog", { name: "Editar empresa" });
    const input = within(dialog).getByLabelText("CNPJ (opcional)");
    expect(input).toHaveValue("12.345.678/0001-95");
    await userEvent.clear(input);
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(updateCompany).toHaveBeenCalledWith(5, { name: "Loja Alfa", timezone: "America/Sao_Paulo", cnpj: null }),
    );
  });
});
