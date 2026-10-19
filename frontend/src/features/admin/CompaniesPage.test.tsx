import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { AppRoutes } from "@/app/routes";
import { useAuth } from "@/stores/auth";
import { renderWithProviders, setTestUser } from "@/test/utils";
import type { AdminCompany } from "@/types/api";
import { createCompany, enterCompany, fetchCompanies, setCompanyBlocked } from "./adminApi";
import { CompaniesPage } from "./CompaniesPage";

vi.mock("./adminApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./adminApi")>()),
  fetchCompanies: vi.fn(),
  createCompany: vi.fn(),
  updateCompany: vi.fn(),
  setCompanyBlocked: vi.fn(),
  enterCompany: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const company = (partial: Partial<AdminCompany> = {}): AdminCompany => ({
  id: 5,
  name: "Loja Alfa",
  status: "active",
  timezone: "America/Sao_Paulo",
  createdAt: "2026-10-01T12:00:00.000Z",
  userCount: 3,
  cnpj: null,
  partner: null,
  ...partial,
});

const superAdmin = () => setTestUser({ id: 99, companyId: null, profile: "superadmin", superAdmin: true, name: "Root" });

beforeEach(() => {
  vi.mocked(fetchCompanies).mockResolvedValue([company(), company({ id: 6, name: "Loja Beta", status: "blocked", userCount: 0 })]);
});

describe("CompaniesPage", () => {
  it("lists companies with their status", async () => {
    superAdmin();
    renderWithProviders(<CompaniesPage />);
    const alfa = (await screen.findByText("Loja Alfa")).closest<HTMLElement>('[role="row"]')!;
    expect(within(alfa).getByText("Ativa")).toBeInTheDocument();
    const beta = screen.getByText("Loja Beta").closest<HTMLElement>('[role="row"]')!;
    expect(within(beta).getByText("Bloqueada")).toBeInTheDocument();
    expect(within(beta).getByRole("button", { name: "Desbloquear Loja Beta" })).toBeInTheDocument();
  });

  it("creates a company with its first admin and shows the temporary password", async () => {
    superAdmin();
    vi.mocked(createCompany).mockResolvedValue({
      company: company({ id: 7, name: "Loja Nova", userCount: 1 }),
      admin: { id: 10, companyId: 7, name: "Ana", email: "ana@loja.com", profile: "admin", phone: null },
      temporaryPassword: "Xy7kPq2mRt",
    });
    renderWithProviders(<CompaniesPage />);
    await screen.findByText("Loja Alfa");

    await userEvent.click(screen.getByRole("button", { name: "Nova empresa" }));
    const dialog = screen.getByRole("dialog", { name: "Nova empresa" });
    await userEvent.type(within(dialog).getByLabelText("Nome da empresa"), "Loja Nova");
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Ana");
    await userEvent.type(within(dialog).getByLabelText("E-mail"), "ana@loja.com");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(createCompany).toHaveBeenCalledWith({
        name: "Loja Nova",
        timezone: "America/Sao_Paulo",
        admin: { name: "Ana", email: "ana@loja.com", phone: null },
      }),
    );
    expect(await screen.findByTestId("temporary-password")).toHaveTextContent("Xy7kPq2mRt");
  });

  it("blocks a company after confirmation", async () => {
    superAdmin();
    vi.mocked(setCompanyBlocked).mockResolvedValue(company({ status: "blocked" }));
    renderWithProviders(<CompaniesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Bloquear Loja Alfa" }));
    const confirm = screen.getByRole("dialog", { name: "Bloquear empresa" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Bloquear" }));
    await waitFor(() => expect(setCompanyBlocked).toHaveBeenCalledWith(5, true));
  });

  it("enters a company and goes to the service screen", async () => {
    superAdmin();
    vi.mocked(enterCompany).mockResolvedValue({
      accessToken: "acting-token",
      refreshToken: "r",
      user: { id: 99, companyId: 5, name: "Root", email: "root@x", profile: "admin", superAdmin: true },
    });
    renderWithProviders(
      <Routes>
        <Route path="/empresas" element={<CompaniesPage />} />
        <Route path="/atendimento" element={<p>tela de atendimento</p>} />
      </Routes>,
      { route: "/empresas" },
    );
    await userEvent.click(await screen.findByRole("button", { name: "Entrar em Loja Alfa" }));
    expect(await screen.findByText("tela de atendimento")).toBeInTheDocument();
    expect(useAuth.getState().user).toMatchObject({ companyId: 5, profile: "admin" });
  });
});

describe("super-admin routing", () => {
  it("sends a super-admin without a company to the companies panel", async () => {
    superAdmin();
    renderWithProviders(<AppRoutes />, { route: "/atendimento" });
    expect(await screen.findByRole("heading", { name: "Empresas" })).toBeInTheDocument();
    expect(screen.getByText("Painel da plataforma")).toBeInTheDocument();
  });

  it("keeps company users out of the companies panel", () => {
    setTestUser({ profile: "admin" });
    renderWithProviders(<AppRoutes />, { route: "/empresas" });
    expect(screen.queryByRole("heading", { name: "Empresas" })).not.toBeInTheDocument();
  });
});
