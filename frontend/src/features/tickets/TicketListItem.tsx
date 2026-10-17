import { UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";
import { formatTime, initials } from "@/lib/format";
import type { Ticket } from "@/types/api";

export function TicketListItem({ ticket, selected }: { ticket: Ticket; selected: boolean }) {
  const name = ticket.contact?.name ?? "Contato";
  return (
    <li>
      <Link
        to={`/atendimento/${ticket.id}`}
        className={cn(
          "flex gap-3 border-l-[3px] border-transparent px-4 py-3 transition hover:bg-background",
          selected && "border-primary bg-primary-soft hover:bg-primary-soft",
        )}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
          {initials(name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate font-semibold">{name}</span>
            <span className="shrink-0 text-xs text-ink-muted">{formatTime(ticket.lastMessageAt)}</span>
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-2">
            <span className="truncate text-sm text-ink-muted">{ticket.lastMessage || "Sem mensagens"}</span>
            {ticket.unreadCount > 0 && (
              <span className="shrink-0 rounded-full bg-primary px-1.5 text-xs font-semibold text-white">
                {ticket.unreadCount}
              </span>
            )}
          </span>
          {(ticket.queue || ticket.user) && (
            <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-ink-muted">
              {ticket.queue && (
                <span className="inline-flex shrink-0 items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ticket.queue.color }} aria-hidden />
                  {ticket.queue.name}
                </span>
              )}
              {ticket.user && (
                <span className="inline-flex min-w-0 items-center gap-1" title={`Técnico: ${ticket.user.name}`}>
                  <UserRound className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">{ticket.user.name}</span>
                </span>
              )}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}
