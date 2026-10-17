import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";

/** Confirma a finalização e deixa escolher se a mensagem de finalização da conexão é enviada. */
export function CloseTicketDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (sendClosingMessage: boolean) => void;
}) {
  const [sendClosingMessage, setSendClosingMessage] = useState(true);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Finalizar atendimento" description="Finalizar este atendimento?" className="max-w-md">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--color-primary)]"
            checked={sendClosingMessage}
            onChange={(e) => setSendClosingMessage(e.target.checked)}
          />
          Enviar mensagem de finalização
        </label>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            autoFocus
            onClick={() => {
              onOpenChange(false);
              onConfirm(sendClosingMessage);
            }}
          >
            Finalizar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
