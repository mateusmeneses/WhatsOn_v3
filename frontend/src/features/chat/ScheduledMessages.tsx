import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ChevronDown, ChevronUp, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/apiError";
import { useRealtimeEvent } from "@/realtime/RealtimeProvider";
import type { Ticket } from "@/types/api";
import { cancelScheduled, createScheduled, fetchScheduled, scheduledKeys } from "./scheduledApi";

/** "YYYY-MM-DDTHH:mm" no fuso local, formato do input datetime-local. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultSendAt(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return toLocalInput(date);
}

const formatSendAt = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function ScheduleDialog({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [sendAt, setSendAt] = useState(defaultSendAt);
  const when = new Date(sendAt);
  const inFuture = !Number.isNaN(when.getTime()) && when.getTime() > Date.now();
  const valid = body.trim().length > 0 && inFuture;

  const mutation = useMutation({
    mutationFn: () => createScheduled(ticket.id, { body: body.trim(), sendAt: when.toISOString() }),
    onSuccess: (row) => {
      toast.success(`Mensagem agendada para ${formatSendAt(row.sendAt)}`);
      void queryClient.invalidateQueries({ queryKey: scheduledKeys.ticket(ticket.id) });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Agendar mensagem"
        description={
          ticket.status === "closed"
            ? "Se o atendimento ainda estiver finalizado no horário, ele será reaberto com você."
            : "A mensagem será enviada automaticamente no horário escolhido."
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (valid) mutation.mutate();
          }}
        >
          <div>
            <Label htmlFor="scheduled-body">Mensagem</Label>
            <Textarea id="scheduled-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="scheduled-at">Enviar em</Label>
            <Input
              id="scheduled-at"
              type="datetime-local"
              min={toLocalInput(new Date())}
              value={sendAt}
              onChange={(e) => setSendAt(e.target.value)}
            />
            {!inFuture && <p className="mt-1 text-xs text-danger">Escolha uma data e hora no futuro.</p>}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={!valid}>
              Agendar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Faixa acima do campo de mensagem: agendamentos pendentes do chamado e o botão de agendar. */
export function ScheduledMessages({ ticket }: { ticket: Ticket }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const key = scheduledKeys.ticket(ticket.id);
  const query = useQuery({ queryKey: key, queryFn: () => fetchScheduled(ticket.id) });
  useRealtimeEvent<{ ticketId: number }>("scheduled:update", (payload) => {
    if (payload.ticketId === ticket.id) void queryClient.invalidateQueries({ queryKey: key });
  });

  const cancel = useMutation({
    mutationFn: (id: number) => cancelScheduled(id),
    onSuccess: () => {
      toast.success("Agendamento cancelado");
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const items = query.data ?? [];

  return (
    <div className="border-t border-border bg-surface px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        {items.length > 0 ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-ink-muted hover:text-ink"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            <CalendarClock className="h-4 w-4" aria-hidden />
            {items.length === 1 ? "1 mensagem agendada" : `${items.length} mensagens agendadas`}
            {expanded ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
          </button>
        ) : (
          <span />
        )}
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          <CalendarClock className="h-4 w-4" aria-hidden /> Agendar mensagem
        </Button>
      </div>
      {expanded && items.length > 0 && (
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-2 rounded-lg bg-background px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-ink-muted">
                  {formatSendAt(item.sendAt)}
                  {item.status === "failed" && (
                    <Badge tone="warning" className="ml-2">
                      Falhou
                    </Badge>
                  )}
                </p>
                <p className="truncate">{item.body}</p>
              </div>
              {item.status !== "sending" && (
                <button
                  type="button"
                  aria-label="Cancelar agendamento"
                  className="rounded p-1 text-ink-muted hover:bg-primary-soft hover:text-danger"
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Cancelar agendamento",
                      description: "Esta mensagem não será enviada.",
                      confirmLabel: "Cancelar envio",
                      cancelLabel: "Manter",
                      danger: true,
                    });
                    if (ok) cancel.mutate(item.id);
                  }}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {open && <ScheduleDialog ticket={ticket} onClose={() => setOpen(false)} />}
    </div>
  );
}
