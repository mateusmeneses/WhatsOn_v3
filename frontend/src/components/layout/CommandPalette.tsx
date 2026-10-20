import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { CornerDownLeft, MessageSquare, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { fetchTickets } from "@/features/tickets/ticketsApi";
import { cn } from "@/lib/cn";
import { formatPhone, initials } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";
import { useAuth } from "@/stores/auth";
import type { Ticket, TicketStatus } from "@/types/api";
import { navItemsFor } from "./Sidebar";

export const OPEN_SEARCH_EVENT = "whatson:open-search";

const STATUS: Record<TicketStatus, { label: string; tone: "neutral" | "warning" | "success" | "primary" }> = {
  bot: { label: "No bot", tone: "neutral" },
  pending: { label: "Aguardando", tone: "warning" },
  open: { label: "Em atendimento", tone: "success" },
  closed: { label: "Finalizado", tone: "neutral" },
};

/** Minúsculas e sem acento, para "configuracoes" achar "Configurações". */
const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Result =
  | { kind: "page"; id: string; label: string; to: string; icon: React.ComponentType<{ className?: string }> }
  | { kind: "ticket"; id: string; ticket: Ticket; to: string };

async function searchTickets(term: string): Promise<Ticket[]> {
  const statuses: TicketStatus[] = ["pending", "open", "closed"];
  const pages = await Promise.allSettled(statuses.map((s) => fetchTickets(s, term, 1)));
  const all = pages.flatMap((p) => (p.status === "fulfilled" ? p.value.items : []));
  // Um item por cliente: o atendimento em andamento (se houver) ou o mais recente.
  const best = new Map<number, Ticket>();
  for (const ticket of all) {
    const current = best.get(ticket.contactId);
    const better =
      !current ||
      (current.status === "closed" && ticket.status !== "closed") ||
      ((current.status === "closed") === (ticket.status === "closed") && (ticket.lastMessageAt ?? "") > (current.lastMessageAt ?? ""));
    if (better) best.set(ticket.contactId, ticket);
  }
  return [...best.values()].sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "")).slice(0, 8);
}

/** Busca rápida (Ctrl/Cmd + K): vai para qualquer página ou abre uma conversa pelo nome ou número do cliente. */
export function CommandPalette() {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const term = useDebounced(query.trim(), 250);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const tickets = useQuery({
    queryKey: ["search", "tickets", term],
    queryFn: () => searchTickets(term),
    enabled: open && term.length >= 2,
    staleTime: 10_000,
  });

  const results = useMemo<Result[]>(() => {
    if (!user) return [];
    const q = fold(query.trim());
    const pages: Result[] = navItemsFor(user.profile)
      .filter((item) => !q || fold(item.label).includes(q))
      .map((item) => ({ kind: "page", id: `page-${item.to}`, label: item.label, to: item.to, icon: item.icon }));
    const conversations: Result[] = (term.length >= 2 ? (tickets.data ?? []) : []).map((ticket) => ({
      kind: "ticket",
      id: `ticket-${ticket.id}`,
      ticket,
      to: `/atendimento/${ticket.id}`,
    }));
    return [...conversations, ...pages];
  }, [user, query, term, tickets.data]);

  useEffect(() => setActive(0), [results.length, term]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function go(result: Result | undefined) {
    if (!result) return;
    setOpen(false);
    navigate(result.to);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    }
  }

  if (!user) return null;
  const searching = term.length >= 2 && tickets.isFetching;
  const firstPage = results.findIndex((r) => r.kind === "page");

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-brand-night/50 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[14vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-surface shadow-pop focus:outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Busca rápida</DialogPrimitive.Title>
          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls="palette-results"
              aria-activedescendant={results[active] ? `palette-${results[active]!.id}` : undefined}
              aria-label="Buscar páginas e conversas"
              placeholder="Ir para uma página ou buscar cliente por nome ou número…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              className="h-14 min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-muted focus:outline-none"
            />
            <kbd className="hidden rounded-md border border-border px-1.5 py-0.5 text-[11px] text-ink-muted sm:block">Esc</kbd>
          </div>
          <ul id="palette-results" role="listbox" ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
            {results.map((r, index) => (
              <li key={r.id} role="presentation">
                {index === 0 && r.kind === "ticket" && <GroupLabel>Conversas</GroupLabel>}
                {index === firstPage && <GroupLabel>Páginas</GroupLabel>}
                <button
                  type="button"
                  id={`palette-${r.id}`}
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  onMouseMove={() => setActive(index)}
                  onClick={() => go(r)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition",
                    index === active ? "bg-primary-soft" : "hover:bg-background",
                  )}
                >
                  {r.kind === "page" ? (
                    <>
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-background text-ink-muted">
                        <r.icon className="h-4 w-4" />
                      </span>
                      <span className="flex-1 font-medium text-ink">{r.label}</span>
                    </>
                  ) : (
                    <>
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                        {initials(r.ticket.contact?.name ?? "?")}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">{r.ticket.contact?.name ?? "Contato"}</span>
                        <span className="block truncate text-xs text-ink-muted">
                          {r.ticket.contact ? formatPhone(r.ticket.contact.number) : ""}
                          {r.ticket.lastMessage ? ` · ${r.ticket.lastMessage}` : ""}
                        </span>
                      </span>
                      <Badge tone={STATUS[r.ticket.status].tone}>{STATUS[r.ticket.status].label}</Badge>
                    </>
                  )}
                  {index === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden />}
                </button>
              </li>
            ))}
            {results.length === 0 && (
              <li role="presentation" className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-ink-muted">
                <MessageSquare className="h-5 w-5" aria-hidden />
                {searching ? "Buscando conversas…" : term.length >= 2 ? "Nada encontrado para essa busca." : "Digite para buscar."}
              </li>
            )}
          </ul>
          <div className="flex items-center justify-between border-t border-border bg-background/60 px-4 py-2 text-[11px] text-ink-muted">
            <span>↑ ↓ para navegar · Enter para abrir</span>
            <span>{searching ? "Buscando…" : "Ctrl K"}</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function GroupLabel({ children }: { children: string }) {
  return <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{children}</p>;
}
