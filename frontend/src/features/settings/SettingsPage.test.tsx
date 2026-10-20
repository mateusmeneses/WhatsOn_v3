import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { fetchCompany, updateCompany } from "./companyApi";
import { SettingsPage } from "./SettingsPage";

vi.mock("./companyApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./companyApi")>()),
  fetchCompany: vi.fn(),
  updateCompany: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("SettingsPage", () => {
  it("loads and saves the company name and time zone", async () => {
    setTestUser({ profile: "admin" });
    vi.mocked(fetchCompany).mockResolvedValue({ id: 1, name: "Loja X", status: "active", timezone: "America/Sao_Paulo", responseSlaMinutes: 5 });
    vi.mocked(updateCompany).mockResolvedValue({ id: 1, name: "Loja Y", status: "active", timezone: "America/Manaus" });
    renderWithProviders(<SettingsPage />);

    const name = await screen.findByLabelText("Nome da empresa");
    expect(name).toHaveValue("Loja X");
    await userEvent.clear(name);
    await userEvent.type(name, "Loja Y");
    await userEvent.selectOptions(screen.getByLabelText("Fuso horário"), "America/Manaus");
    const goal = screen.getByLabelText("Meta de primeira resposta (minutos)");
    expect(goal).toHaveValue(5);
    await userEvent.clear(goal);
    await userEvent.type(goal, "10");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(updateCompany).toHaveBeenCalledWith({ name: "Loja Y", timezone: "America/Manaus", responseSlaMinutes: 10 }));
    expect(toast.success).toHaveBeenCalledWith("Configurações salvas");
  });

  it("blocks saving a goal outside 1 to 240 minutes", async () => {
    setTestUser({ profile: "admin" });
    vi.mocked(fetchCompany).mockResolvedValue({ id: 1, name: "Loja X", status: "active", timezone: "America/Sao_Paulo", responseSlaMinutes: 5 });
    renderWithProviders(<SettingsPage />);
    const goal = await screen.findByLabelText("Meta de primeira resposta (minutos)");
    await userEvent.clear(goal);
    await userEvent.type(goal, "0");
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
    await userEvent.clear(goal);
    await userEvent.type(goal, "30");
    expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
  });
});
