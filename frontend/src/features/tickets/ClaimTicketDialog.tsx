import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export const CLAIM_NOTE_MAX = 1000;

/** Confirma o requerer de um atendimento que está com outro técnico, com recado interno opcional para ele. */
export function ClaimTicketDialog({
  holderName,
  open,
  onOpenChange,
  onConfirm,
}: {
  holderName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Requerer atendimento"
        description={`O atendimento sai de ${holderName} e passa para você agora.`}
        className="max-w-md"
      >
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Recado para {holderName} (opcional)</span>
          <Textarea
            rows={4}
            maxLength={CLAIM_NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ex.: esse cliente é da minha carteira, eu sigo daqui."
          />
        </label>
        <p className="text-xs text-ink-muted">Só {holderName} vê o recado. O cliente não recebe nada.</p>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            autoFocus
            onClick={() => {
              onOpenChange(false);
              onConfirm(note.trim());
            }}
          >
            Requerer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
