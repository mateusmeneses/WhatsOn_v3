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
    vi.mocked(fetchCompany).mockResolvedValue({ id: 1, name: "Loja X", status: "active", timezone: "America/Sao_Paulo" });
    vi.mocked(updateCompany).mockResolvedValue({ id: 1, name: "Loja Y", status: "active", timezone: "America/Manaus" });
    renderWithProviders(<SettingsPage />);

    const name = await screen.findByLabelText("Nome da empresa");
    expect(name).toHaveValue("Loja X");
    await userEvent.clear(name);
    await userEvent.type(name, "Loja Y");
    await userEvent.selectOptions(screen.getByLabelText("Fuso horário"), "America/Manaus");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(updateCompany).toHaveBeenCalledWith({ name: "Loja Y", timezone: "America/Manaus" }));
    expect(toast.success).toHaveBeenCalledWith("Configurações salvas");
  });
});
