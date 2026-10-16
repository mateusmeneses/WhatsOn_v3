import { useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { EditContactDialog } from "@/features/contacts/EditContactDialog";
import { fetchTicketAttendants, ticketKeys } from "@/features/tickets/ticketsApi";
import { formatPhone, initials } from "@/lib/format";
import type { Ticket, TicketStatus } from "@/types/api";

const STATUS: Record<TicketStatus, { label: string; tone: "neutral" | "primary" | "success" | "warning" }> = {
  bot: { label: "No bot", tone: "neutral" },
  pending: { label: "Aguardando", tone: "warning" },
  open: { label: "Em atendimento", tone: "success" },
  closed: { label: "Finalizado", tone: "neutral" },
};

export function ChatHeader({ ticket, actions }: { ticket: Ticket; actions?: ReactNode }) {
  const contact = ticket.contact;
  const status = STATUS[ticket.status];
  const [editing, setEditing] = useState(false);
  // refaz a busca a cada mudança do ticket (aceite, transferência, nova resposta)
  const attendants = useQuery({
    queryKey: [...ticketKeys.attendants(ticket.id), ticket.updatedAt],
    queryFn: () => fetchTicketAttendants(ticket.id),
    placeholderData: (prev) => prev,
  }).data;

  return (
    <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
          {initials(contact?.name ?? "?")}
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1">
            <p className="truncate font-semibold">{contact?.name ?? "Contato"}</p>
            {contact && (
              <button
                type="button"
                className="shrink-0 rounded p-1 text-ink-muted hover:bg-primary-soft hover:text-primary"
                aria-label="Editar nome do contato"
                title="Editar nome do contato"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>
          <p className="text-xs text-ink-muted">{contact ? formatPhone(contact.number) : ""}</p>
          {attendants && attendants.length > 0 && (
            <p className="truncate text-xs text-ink-muted" data-testid="ticket-attendants">
              {attendants.length === 1 ? "Técnico: " : "Técnicos: "}
              {attendants.map((u, i) => (
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
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
        {ticket.queue && (
          <Badge tone="primary" style={{ backgroundColor: `${ticket.queue.color}1a`, color: ticket.queue.color }}>
            {ticket.queue.name}
          </Badge>
        )}
      </div>
      {actions}
      {editing && contact && <EditContactDialog contact={contact} onClose={() => setEditing(false)} />}
    </header>
  );
}
