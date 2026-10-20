import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Badge } from "./badge";
import { Button } from "./button";
import { Dialog, DialogContent } from "./dialog";
import { EmptyState } from "./empty-state";
import { Tabs } from "./tabs";
import { Inbox } from "lucide-react";

describe("ui primitives", () => {
  it("disables the button and shows a spinner while loading", () => {
    render(<Button loading>Salvar</Button>);
    expect(screen.getByRole("button", { name: /salvar/i })).toBeDisabled();
    expect(screen.getByTestId("spinner")).toBeInTheDocument();
  });

  it("renders dialog content with an accessible title when open", () => {
    render(
      <Dialog open onOpenChange={() => undefined}>
        <DialogContent title="Nova fila" description="Preencha os dados">
          conteúdo
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Nova fila" })).toBeInTheDocument();
    expect(screen.getByText("conteúdo")).toBeInTheDocument();
  });

  it("marks the selected tab and reports clicks", async () => {
    const onChange = vi.fn();
    render(
      <Tabs
        value="a"
        onChange={onChange}
        items={[
          { value: "a", label: "A" },
          { value: "b", label: "B", count: 3 },
        ]}
      />,
    );
    expect(screen.getByRole("tab", { name: "A" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: /B/ }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("keeps tab labels on one line with compact text below lg", () => {
    render(<Tabs value="a" onChange={vi.fn()} items={[{ value: "a", label: "Finalizados" }]} />);
    const tab = screen.getByRole("tab", { name: "Finalizados" });
    expect(tab.className).toContain("whitespace-nowrap");
    expect(tab.className).toContain("text-xs");
    expect(tab.className).toContain("lg:text-sm");
  });

  it("applies the tone to badges", () => {
    render(<Badge tone="success">Conectado</Badge>);
    expect(screen.getByText("Conectado").className).toContain("text-success");
  });

  it("renders empty states with title and description", () => {
    render(<EmptyState icon={Inbox} title="Nada aqui" description="Tudo em dia" />);
    expect(screen.getByText("Nada aqui")).toBeInTheDocument();
    expect(screen.getByText("Tudo em dia")).toBeInTheDocument();
  });
});

describe("Tabs keyboard support", () => {
  it("moves the selection with arrow keys, Home and End, and keeps only the active tab in the tab order", async () => {
    const onChange = vi.fn();
    const items = [{ value: "a", label: "Alfa" }, { value: "b", label: "Beta" }, { value: "c", label: "Gama" }];
    render(<Tabs value="a" onChange={onChange} items={items} />);
    const [alfa, beta, gama] = screen.getAllByRole("tab");
    expect(alfa).toHaveAttribute("tabindex", "0");
    expect(beta).toHaveAttribute("tabindex", "-1");
    alfa!.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("b");
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("c"); // volta circular
    await userEvent.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("c");
    await userEvent.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith("a");
    expect(gama).toBeInTheDocument();
  });
});
