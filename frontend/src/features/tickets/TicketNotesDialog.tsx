import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/apiError";
import type { Ticket } from "@/types/api";
import { ticketKeys, updateTicketNotes } from "./ticketsApi";

export const TICKET_NOTES_MAX = 5000;

/** Observações internas do atendimento: ficam só para a equipe, o cliente nunca vê. */
export function TicketNotesDialog({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(ticket.notes);
  const mutation = useMutation({
    mutationFn: () => updateTicketNotes(ticket.id, notes.trim()),
    onSuccess: (updated) => {
      toast.success("Observações salvas");
      queryClient.setQueryData(ticketKeys.detail(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="Observações do atendimento" description="Uso interno: o cliente não vê este texto.">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <Textarea
            aria-label="Observações"
            rows={8}
            maxLength={TICKET_NOTES_MAX}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
