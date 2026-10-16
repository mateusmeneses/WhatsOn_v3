import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { useAuth } from "@/stores/auth";
import { changePassword } from "./authApi";
import { ChangePasswordPage } from "./ChangePasswordPage";

vi.mock("./authApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./authApi")>()),
  changePassword: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderApp(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/trocar-senha" element={<ChangePasswordPage />} />
      <Route
        path="/atendimento"
        element={
          <ProtectedRoute>
            <p>Tela de atendimento</p>
          </ProtectedRoute>
        }
      />
    </Routes>,
    { route },
  );
}

describe("ChangePasswordPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends a user with a temporary password to the change-password screen", async () => {
    setTestUser({ mustChangePassword: true });
    renderApp("/atendimento");
    expect(await screen.findByRole("heading", { name: /crie sua nova senha/i })).toBeInTheDocument();
    expect(screen.queryByText("Tela de atendimento")).not.toBeInTheDocument();
  });

  it("saves the new password and enters the app", async () => {
    const user = setTestUser({ mustChangePassword: true });
    vi.mocked(changePassword).mockResolvedValue({
      accessToken: "novo",
      refreshToken: "novo-refresh",
      user: { ...user, mustChangePassword: false },
    });
    renderApp("/trocar-senha");

    const save = screen.getByRole("button", { name: "Salvar nova senha" });
    await userEvent.type(screen.getByLabelText("Senha temporária"), "temp1234");
    await userEvent.type(screen.getByLabelText("Nova senha"), "minhaSenha9");
    await userEvent.type(screen.getByLabelText("Confirme a nova senha"), "minhaSenha");
    expect(screen.getByText("As senhas não conferem.")).toBeInTheDocument();
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Confirme a nova senha"), "9");
    await userEvent.click(save);

    await waitFor(() => expect(changePassword).toHaveBeenCalledWith("temp1234", "minhaSenha9"));
    expect(await screen.findByText("Tela de atendimento")).toBeInTheDocument();
    expect(useAuth.getState().accessToken).toBe("novo");
  });

  it("lets a user without a temporary password skip the screen", async () => {
    setTestUser({ mustChangePassword: false });
    renderApp("/trocar-senha");
    expect(await screen.findByText("Tela de atendimento")).toBeInTheDocument();
  });
});
