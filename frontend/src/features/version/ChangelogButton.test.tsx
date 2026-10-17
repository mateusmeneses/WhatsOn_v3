import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/utils";
import { ChangelogButton } from "./ChangelogButton";
import { fetchChangelog, fetchVersion } from "./versionApi";

vi.mock("./versionApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./versionApi")>()),
  fetchVersion: vi.fn(),
  fetchChangelog: vi.fn(),
}));

describe("ChangelogButton", () => {
  it("shows the latest versions and the installed one", async () => {
    vi.mocked(fetchVersion).mockResolvedValue({ version: "2026.10.17.1", buildTime: "" });
    vi.mocked(fetchChangelog).mockResolvedValue([
      { versao: "2026.10.17.1", data: "17/10/2026", titulo: "Assinatura", novidades: ["Mensagens assinadas"] },
      { versao: "2026.10.16.1", data: "16/10/2026", titulo: "Anterior", correcoes: ["Correção X"] },
    ]);
    renderWithProviders(<ChangelogButton />);
    await userEvent.click(screen.getByRole("button", { name: "Novidades desta versão" }));
    const dialog = await screen.findByRole("dialog", { name: "Novidades do sistema" });
    expect(await within(dialog).findByText("Mensagens assinadas")).toBeInTheDocument();
    expect(within(dialog).getByText("Mais recente")).toBeInTheDocument();
    expect(within(dialog).getByText("Correção X")).toBeInTheDocument();
    expect(await within(dialog).findByText("Versão instalada: 2026.10.17.1")).toBeInTheDocument();
  });

  it("explains when there is no changelog", async () => {
    vi.mocked(fetchVersion).mockResolvedValue({ version: "2026.10.17.1", buildTime: "" });
    vi.mocked(fetchChangelog).mockResolvedValue([]);
    renderWithProviders(<ChangelogButton />);
    await userEvent.click(screen.getByRole("button", { name: "Novidades desta versão" }));
    expect(await screen.findByText("Ainda não há novidades registradas.")).toBeInTheDocument();
  });
});
