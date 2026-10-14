import { useMutation } from "@tanstack/react-query";
import { ArrowRightLeft, Check, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/apiError";
import { useAuth } from "@/stores/auth";
import type { Ticket } from "@/types/api";
import { TransferDialog } from "./TransferDialog";
import { acceptTicket, closeTicket } from "./ticketsApi";
import { useApplyTicket, useViewer } from "./useTickets";
import { ticketVisibleIn } from "./visibility";

export function TicketActions({ ticket }: { ticket: Ticket }) {
  const user = useAuth((s) => s.user)!;
  const applyTicket = useApplyTicket();
  const viewer = useViewer();
  const navigate = useNavigate();
  const [transferOpen, setTransferOpen] = useState(false);

  const onError = (err: unknown) => toast.error(errorMessage(err));
  const accept = useMutation({
    mutationFn: () => acceptTicket(ticket.id),
    onSuccess: (updated) => {
      applyTicket(updated);
      toast.success("Atendimento aceito");
    },
    onError,
  });
  const close = useMutation({
    mutationFn: () => closeTicket(ticket.id),
    onSuccess: (updated) => {
      applyTicket(updated);
      toast.success("Atendimento finalizado");
    },
    onError,
  });

  const canHandle = ticket.status !== "closed" && (user.profile !== "agent" || ticket.userId === user.id);

  function onTransferred(updated: Ticket) {
    applyTicket(updated);
    if (viewer && !ticketVisibleIn(updated, updated.status, viewer)) navigate("/atendimento");
  }

  return (
    <div className="flex shrink-0 gap-2">
      {ticket.status === "pending" && (
        <Button size="sm" loading={accept.isPending} onClick={() => accept.mutate()}>
          <Check className="h-4 w-4" aria-hidden /> Aceitar
        </Button>
      )}
      {canHandle && (
        <>
          <Button size="sm" variant="secondary" onClick={() => setTransferOpen(true)}>
            <ArrowRightLeft className="h-4 w-4" aria-hidden /> Transferir
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={close.isPending}
            onClick={() => {
              if (window.confirm("Finalizar este atendimento?")) close.mutate();
            }}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Finalizar
          </Button>
          {transferOpen && (
            <TransferDialog ticket={ticket} open={transferOpen} onOpenChange={setTransferOpen} onTransferred={onTransferred} />
          )}
        </>
      )}
    </div>
  );
}
