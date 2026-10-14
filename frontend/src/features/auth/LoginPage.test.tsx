import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { AppRoutes } from "@/app/routes";
import { useAuth } from "@/stores/auth";
import { renderWithProviders } from "@/test/utils";
import { login } from "./authApi";

vi.mock("./authApi", () => ({ login: vi.fn(), logout: vi.fn() }));

const user = { id: 7, companyId: 1, name: "Bruno", email: "bruno@test.local", profile: "admin" as const };

function apiError(status: number, code: string, message: string) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError("fail", "ERR", config, null, {
    status,
    statusText: "",
    headers: {},
    config,
    data: { error: { code, message } },
  });
}

describe("LoginPage", () => {
  beforeEach(() => useAuth.getState().clear());

  it("logs in and opens the attendance screen", async () => {
    vi.mocked(login).mockResolvedValue({ accessToken: "a", refreshToken: "r", user });
    renderWithProviders(<AppRoutes />, { route: "/login" });

    await userEvent.type(screen.getByLabelText("E-mail"), "bruno@test.local");
    await userEvent.type(screen.getByLabelText("Senha"), "senha123");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByRole("heading", { name: "Atendimentos" })).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith("bruno@test.local", "senha123");
    expect(useAuth.getState().user?.id).toBe(7);
  });

  it("shows the API error on invalid credentials", async () => {
    vi.mocked(login).mockRejectedValue(apiError(401, "INVALID_CREDENTIALS", "E-mail ou senha inválidos"));
    renderWithProviders(<AppRoutes />, { route: "/login" });

    await userEvent.type(screen.getByLabelText("E-mail"), "x@test.local");
    await userEvent.type(screen.getByLabelText("Senha"), "errada");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("E-mail ou senha inválidos");
  });

  it("redirects anonymous visitors to the login page", () => {
    renderWithProviders(<AppRoutes />, { route: "/atendimento" });
    expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument();
  });
});
