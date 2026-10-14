import { screen } from "@testing-library/react";
import { AppRoutes } from "@/app/routes";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { navItemsFor } from "./Sidebar";

describe("Sidebar", () => {
  it("shows only the agent's pages to agents", () => {
    setTestUser({ profile: "agent" });
    renderWithProviders(<AppRoutes />, { route: "/atendimento" });
    expect(screen.getByRole("link", { name: "Atendimento" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contatos" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Conexões" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Usuários" })).not.toBeInTheDocument();
  });

  it("gives admins every page and supervisors the user list", () => {
    expect(navItemsFor("admin").map((i) => i.label)).toEqual([
      "Atendimento",
      "Contatos",
      "Filas",
      "Usuários",
      "Conexões",
      "Chatbot",
      "Configurações",
    ]);
    expect(navItemsFor("supervisor").map((i) => i.label)).toEqual(["Atendimento", "Contatos", "Usuários"]);
  });
});
