import { ClipboardList, ExternalLink, History, NotebookPen, Pencil } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { EditContactDialog } from "@/features/contacts/EditContactDialog";
import { OpenOsDialog } from "@/features/manager/OpenOsDialog";
import { RegisterAtendimentoDialog } from "@/features/manager/RegisterAtendimentoDialog";
import { useManagerEnabled } from "@/features/manager/managerApi";
import { TicketNotesDialog } from "@/features/tickets/TicketNotesDialog";
import { TicketHistoryDialog } from "@/features/tickets/TicketHistoryDialog";
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [osOpen, setOsOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const managerEnabled = useManagerEnabled();

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-surface px-5 py-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
          {initials(contact?.name ?? "?")}
        </span>
        <div className="min-w-[10rem] max-w-full">
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
        </div>
        {ticket.botPath && (
          <Badge tone="neutral" title="Opções escolhidas pelo cliente no menu">
            {ticket.botPath}
          </Badge>
        )}
        <Badge tone={status.tone}>{status.label}</Badge>
        {ticket.queue && (
          <Badge tone="primary" style={{ backgroundColor: `${ticket.queue.color}1a`, color: ticket.queue.color }}>
            {ticket.queue.name}
          </Badge>
        )}
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink-muted hover:bg-primary-soft hover:text-primary"
          title="Técnicos que atenderam e transferências"
          onClick={() => setHistoryOpen(true)}
        >
          <History className="h-3.5 w-3.5" aria-hidden /> Histórico
        </button>
        <button
          type="button"
          className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-primary-soft hover:text-primary ${ticket.notes ? "text-primary" : "text-ink-muted"}`}
          title={ticket.notes || "Observações internas do atendimento"}
          onClick={() => setNotesOpen(true)}
        >
          <NotebookPen className="h-3.5 w-3.5" aria-hidden /> {ticket.notes ? "Observações •" : "Observações"}
        </button>
        {managerEnabled && (
          <>
            {ticket.managerOsId ? (
              <a
                href={ticket.managerOsUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft"
                title="Abrir a OS no Manager"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden /> OS #{ticket.managerOsId}
              </a>
            ) : (
              <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink-muted hover:bg-primary-soft hover:text-primary" title="Abrir uma OS no Manager" onClick={() => setOsOpen(true)}>
                <ClipboardList className="h-3.5 w-3.5" aria-hidden /> Abrir OS
              </button>
            )}
            {ticket.managerAtendimentoId ? (
              <span className="shrink-0 px-2 py-1 text-xs text-ink-muted">Registrado no Manager #{ticket.managerAtendimentoId}</span>
            ) : (
              <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink-muted hover:bg-primary-soft hover:text-primary" title="Registrar este atendimento no Manager" onClick={() => setRegisterOpen(true)}>
                <ClipboardList className="h-3.5 w-3.5" aria-hidden /> Registrar no Manager
              </button>
            )}
          </>
        )}
      </div>
      {actions}
      {editing && contact && <EditContactDialog contact={contact} onClose={() => setEditing(false)} />}
      {osOpen && <OpenOsDialog ticket={ticket} onClose={() => setOsOpen(false)} />}
      {registerOpen && <RegisterAtendimentoDialog ticket={ticket} onClose={() => setRegisterOpen(false)} />}
      {notesOpen && <TicketNotesDialog ticket={ticket} onClose={() => setNotesOpen(false)} />}
      {historyOpen && <TicketHistoryDialog ticket={ticket} onClose={() => setHistoryOpen(false)} />}
    </header>
  );
}
