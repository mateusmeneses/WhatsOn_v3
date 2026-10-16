import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmProvider, useConfirm } from "./confirm";

function Trigger({ onResult, danger }: { onResult: (ok: boolean) => void; danger?: boolean }) {
  const confirm = useConfirm();
  return (
    <button type="button" onClick={async () => onResult(await confirm({ title: "Excluir fila", confirmLabel: "Excluir", danger }))}>
      abrir
    </button>
  );
}

function setup(danger?: boolean) {
  const onResult = vi.fn();
  render(
    <ConfirmProvider>
      <Trigger onResult={onResult} danger={danger} />
    </ConfirmProvider>,
  );
  return onResult;
}

describe("ConfirmProvider / useConfirm", () => {
  it("resolve true e mostra o título quando confirma", async () => {
    const onResult = setup(true);
    await userEvent.click(screen.getByRole("button", { name: "abrir" }));
    expect(await screen.findByRole("dialog", { name: "Excluir fila" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Excluir" }));
    expect(onResult).toHaveBeenCalledWith(true);
  });

  it("resolve false quando cancela", async () => {
    const onResult = setup();
    await userEvent.click(screen.getByRole("button", { name: "abrir" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(onResult).toHaveBeenCalledWith(false);
  });
});
