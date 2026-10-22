import { MessagesSquare, Search } from "lucide-react";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { useDebounced } from "@/lib/useDebounced";
import { useAuth } from "@/stores/auth";
import type { TicketStatus } from "@/types/api";
import { TicketList } from "./TicketList";
import { useViewer } from "./useTickets";

type Scope = "all" | "mine";
const SCOPE_KEY = "whatson.ticketScope";

function readScope(): Scope {
  try {
    return localStorage.getItem(SCOPE_KEY) === "mine" ? "mine" : "all";
  } catch {
    return "all";
  }
}

export function TicketsPage() {
  const user = useAuth((s) => s.user)!;
  const viewer = useViewer();
  const { ticketId } = useParams();
  const selectedId = ticketId ? Number(ticketId) : null;
  // ?aba=pending|open|closed|bot abre direto na aba (atalhos do dashboard e das filas).
  const [searchParams] = useSearchParams();
  const [selectedStatus, setStatus] = useState<TicketStatus>(() => {
    const aba = searchParams.get("aba");
    return aba === "open" || aba === "closed" || aba === "bot" ? aba : "pending";
  });
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<Scope>(readScope);
  const mine = scope === "mine";
  const changeScope = (next: Scope) => {
    setScope(next);
    try {
      localStorage.setItem(SCOPE_KEY, next);
    } catch {
      /* preferência é só conveniência */
    }
  };
  const debouncedSearch = useDebounced(search.trim());

  const showBot = user.profile !== "agent" || Boolean(viewer?.canViewBot);
  // Permissão retirada com a aba Bot aberta: volta para Aguardando.
  const status = selectedStatus === "bot" && !showBot ? "pending" : selectedStatus;
  const tabs: TabItem<TicketStatus>[] = [
    { value: "pending", label: "Aguardando" },
    { value: "open", label: "Atendendo" },
    { value: "closed", label: "Finalizados" },
    ...(showBot ? [{ value: "bot" as const, label: "Bot" }] : []),
  ];

  return (
    <div className="flex h-full">
      <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-surface lg:w-96">
        <div className="space-y-3 border-b border-border p-4">
          <h1 className="text-lg font-semibold">Atendimentos</h1>
          <Tabs value={status} onChange={setStatus} items={tabs} />
          <Tabs
            value={scope}
            onChange={changeScope}
            items={[
              { value: "all", label: "Todos" },
              { value: "mine", label: "Só meus" },
            ]}
          />
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
            <Input
              className="pl-9"
              placeholder="Buscar por nome ou número"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <TicketList status={status} search={debouncedSearch} mine={mine} selectedId={selectedId} />
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        {selectedId ? (
          <ChatPanel key={selectedId} ticketId={selectedId} />
        ) : (
          <EmptyState
            className="h-full"
            icon={MessagesSquare}
            title="Selecione um atendimento"
            description="Escolha uma conversa na lista para começar."
          />
        )}
      </section>
    </div>
  );
}
