import { useQuery } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { companyKeys, fetchCompany } from "@/features/settings/companyApi";
import { errorMessage } from "@/lib/apiError";
import { useNow } from "@/lib/useNow";
import type { Ticket, TicketStatus } from "@/types/api";
import { TicketListItem } from "./TicketListItem";
import { useTicketList } from "./useTickets";

/** Um ticket pode reaparecer na página seguinte quando a lista muda entre as cargas; mantém a primeira ocorrência. */
function uniqueById(tickets: Ticket[]): Ticket[] {
  const seen = new Set<number>();
  return tickets.filter((ticket) => {
    if (seen.has(ticket.id)) return false;
    seen.add(ticket.id);
    return true;
  });
}

export function TicketList({ status, search, mine, selectedId }: { status: TicketStatus; search: string; mine: boolean; selectedId: number | null }) {
  const query = useTicketList(status, search, mine);
  const now = useNow(30_000);
  // Meta de resposta da empresa (opcional): sem ela o tempo aparece sem alerta de cor.
  const company = useQuery({ queryKey: companyKeys.current, queryFn: fetchCompany, staleTime: 5 * 60_000, enabled: status === "pending" });
  const goalSeconds = company.data?.responseSlaMinutes ? company.data.responseSlaMinutes * 60 : undefined;
  const tickets = uniqueById(query.data?.pages.flatMap((page) => page.items) ?? []);

  if (query.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (query.isError) return <p className="p-4 text-sm text-danger">{errorMessage(query.error)}</p>;
  if (tickets.length === 0) {
    return (
      <EmptyState
        className="flex-1"
        icon={Inbox}
        title="Nenhum atendimento"
        description="Quando houver conversas nesta aba, elas aparecem aqui."
      />
    );
  }
  return (
    <ul aria-label="Lista de atendimentos" className="flex-1 divide-y divide-border overflow-y-auto">
      {tickets.map((ticket) => (
        <TicketListItem key={ticket.id} ticket={ticket} selected={ticket.id === selectedId} now={now} goalSeconds={goalSeconds} />
      ))}
      {query.hasNextPage && (
        <li className="p-3">
          <Button
            variant="ghost"
            className="w-full"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Carregar mais
          </Button>
        </li>
      )}
    </ul>
  );
}
