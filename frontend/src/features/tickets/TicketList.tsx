import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/apiError";
import type { TicketStatus } from "@/types/api";
import { TicketListItem } from "./TicketListItem";
import { useTicketList } from "./useTickets";

export function TicketList({ status, search, selectedId }: { status: TicketStatus; search: string; selectedId: number | null }) {
  const query = useTicketList(status, search);
  const tickets = query.data?.pages.flatMap((page) => page.items) ?? [];

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
        <TicketListItem key={ticket.id} ticket={ticket} selected={ticket.id === selectedId} />
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
