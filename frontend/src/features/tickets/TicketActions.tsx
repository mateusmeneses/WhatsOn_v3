import { useMutation } from "@tanstack/react-query";
import { ArrowRightLeft, Check, CheckCircle2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { errorMessage } from "@/lib/apiError";
import { useAuth } from "@/stores/auth";
import type { Ticket } from "@/types/api";
import { CloseTicketDialog } from "./CloseTicketDialog";
import { TransferDialog } from "./TransferDialog";
import { acceptTicket, closeTicket, reopenTicket } from "./ticketsApi";
import { useApplyTicket, useViewer } from "./useTickets";
import { ticketVisibleIn } from "./visibility";

export function TicketActions({ ticket }: { ticket: Ticket }) {
  const user = useAuth((s) => s.user)!;
  const confirm = useConfirm();
  const applyTicket = useApplyTicket();
  const viewer = useViewer();
  const navigate = useNavigate();
  const [transferOpen, setTransferOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

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
    mutationFn: (sendClosingMessage: boolean) => closeTicket(ticket.id, sendClosingMessage),
    onSuccess: (updated) => {
      applyTicket(updated);
      toast.success("Atendimento finalizado");
    },
    onError,
  });

  const reopen = useMutation({
    mutationFn: () => reopenTicket(ticket.id),
    onSuccess: (updated) => {
      applyTicket(updated);
      toast.success("Atendimento reaberto");
    },
    onError,
  });

  const isMineOrSupervisor = user.profile !== "agent" || ticket.userId === user.id;
  const canHandle = ticket.status !== "closed" && isMineOrSupervisor;
  const canReopen = ticket.status === "closed" && isMineOrSupervisor;

  function onTransferred(updated: Ticket) {
    applyTicket(updated);
    if (viewer && !ticketVisibleIn(updated, updated.status, viewer)) navigate("/atendimento");
  }

  return (
    <div className="flex shrink-0 gap-2">
      {(ticket.status === "pending" || ticket.status === "bot") && (
        <Button size="sm" loading={accept.isPending} onClick={() => accept.mutate()}>
          <Check className="h-4 w-4" aria-hidden /> Aceitar
        </Button>
      )}
      {canReopen && (
        <Button
          size="sm"
          loading={reopen.isPending}
          onClick={async () => {
            const ok = await confirm({
              title: "Reabrir atendimento",
              description: "O atendimento volta para “Em atendimento” com você.",
              confirmLabel: "Reabrir",
            });
            if (ok) reopen.mutate();
          }}
        >
          <RotateCcw className="h-4 w-4" aria-hidden /> Reabrir
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
            onClick={() => setCloseOpen(true)}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Finalizar
          </Button>
          {closeOpen && (
            <CloseTicketDialog open={closeOpen} onOpenChange={setCloseOpen} onConfirm={(send) => close.mutate(send)} />
          )}
          {transferOpen && (
            <TransferDialog ticket={ticket} open={transferOpen} onOpenChange={setTransferOpen} onTransferred={onTransferred} />
          )}
        </>
      )}
    </div>
  );
}
