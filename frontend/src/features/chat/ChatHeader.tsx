import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
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
  return (
    <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
          {initials(contact?.name ?? "?")}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{contact?.name ?? "Contato"}</p>
          <p className="text-xs text-ink-muted">
            {contact ? formatPhone(contact.number) : ""}
            {ticket.user ? ` · ${ticket.user.name}` : ""}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
        {ticket.queue && (
          <Badge tone="primary" style={{ backgroundColor: `${ticket.queue.color}1a`, color: ticket.queue.color }}>
            {ticket.queue.name}
          </Badge>
        )}
      </div>
      {actions}
    </header>
  );
}
