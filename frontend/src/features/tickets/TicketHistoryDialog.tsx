import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, Bot, Check, CheckCircle2, Clock, Hand, MessageCircle, RotateCcw, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { Ticket, TicketEvent, TicketHistoryEntry } from "@/types/api";
import { fetchTicketAttendants, fetchTicketHistory, ticketKeys } from "./ticketsApi";

const ICON: Record<TicketEvent, LucideIcon> = {
  created: MessageCircle,
  accepted: Check,
  transferred: ArrowRightLeft,
  closed: CheckCircle2,
  bot_timeout: Bot,
  inactivity: Clock,
  reopened: RotateCcw,
  claimed: Hand,
};

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function describe(entry: TicketHistoryEntry): { title: string; detail?: string } {
  const by = entry.user?.name;
  switch (entry.event) {
    case "created":
      return { title: "Atendimento iniciado pelo cliente" };
    case "accepted":
      return { title: by ? `Aceito por ${by}` : "Assumido por mensagem enviada direto do WhatsApp" };
    case "transferred": {
      const route = `${entry.fromQueue?.name ?? "Sem fila"} → ${entry.toQueue?.name ?? "Sem fila"}`;
      return {
        title: by ? `Transferido por ${by}` : "Encaminhado pelo chatbot",
        detail: entry.toUser ? `${route} · para ${entry.toUser.name}` : route,
      };
    }
    case "closed":
      return { title: by ? `Finalizado por ${by}` : "Finalizado" };
    case "bot_timeout":
      return { title: "Encerrado por falta de resposta no chatbot" };
    case "inactivity":
      return { title: "Finalizado por inatividade do cliente" };
    case "reopened":
      return { title: by ? `Reaberto por ${by}` : "Reaberto, voltou para a fila" };
    case "claimed":
      return {
        title: `Requerido por ${by ?? "outro técnico"}`,
        detail: entry.fromUser ? `Estava com ${entry.fromUser.name}` : undefined,
      };
  }
}

/** Histórico do atendimento: técnicos que passaram pelo chamado e a linha do tempo das transferências. */
export function TicketHistoryDialog({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  // refaz a busca a cada mudança do ticket (aceite, transferência, finalização)
  const history = useQuery({
    queryKey: [...ticketKeys.history(ticket.id), ticket.updatedAt],
    queryFn: () => fetchTicketHistory(ticket.id),
  });
  const attendants = useQuery({
    queryKey: [...ticketKeys.attendants(ticket.id), ticket.updatedAt],
    queryFn: () => fetchTicketAttendants(ticket.id),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="Histórico do atendimento" className="max-w-lg">
        {attendants.data && attendants.data.length > 0 && (
          <p className="text-sm text-ink-muted" data-testid="ticket-attendants">
            {attendants.data.length === 1 ? "Técnico: " : "Técnicos: "}
            {attendants.data.map((u, i) => (
              <span key={u.id}>
                {i > 0 && ", "}
                <span
                  className={u.id === ticket.userId ? "font-medium text-ink" : undefined}
                  title={u.id === ticket.userId ? "Responsável atual" : undefined}
                >
                  {u.name}
                </span>
              </span>
            ))}
          </p>
        )}
        {history.isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : history.isError ? (
          <p className="text-sm text-danger">Não foi possível carregar o histórico.</p>
        ) : !history.data?.length ? (
          <p className="text-sm text-ink-muted">Ainda não há eventos registrados neste atendimento.</p>
        ) : (
          <ol className="max-h-[60vh] overflow-y-auto pr-1" aria-label="Linha do tempo do atendimento">
            {history.data.map((entry, i) => {
              const Icon = ICON[entry.event];
              const { title, detail } = describe(entry);
              const last = i === history.data.length - 1;
              return (
                <li key={entry.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    {!last && <span className="w-px flex-1 bg-border" aria-hidden />}
                  </div>
                  <div className={last ? "pb-1" : "pb-4"}>
                    <p className="text-sm font-medium">{title}</p>
                    {detail && <p className="text-xs text-ink-muted">{detail}</p>}
                    {entry.note && (
                      <p className="mt-1 whitespace-pre-wrap rounded-md bg-primary-soft px-2 py-1 text-xs" title="Recado interno">
                        Recado: {entry.note}
                      </p>
                    )}
                    <p className="text-xs text-ink-muted">{dateTime(entry.createdAt)}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
