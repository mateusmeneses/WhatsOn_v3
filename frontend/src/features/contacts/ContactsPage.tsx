import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BookUser, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/apiError";
import { timeAgo } from "@/lib/duration";
import { formatPhone, initials } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";
import type { Contact } from "@/types/api";
import { contactKeys, fetchContacts, fetchContactStats, type ContactStats } from "./contactsApi";
import { EditContactDialog } from "./EditContactDialog";

export function ContactsPage() {
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search.trim());
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Contact | null>(null);

  useEffect(() => setPage(1), [debounced]);

  const query = useQuery({
    queryKey: contactKeys.list(debounced, page),
    queryFn: () => fetchContacts(debounced, page),
    placeholderData: keepPreviousData,
  });

  const ids = query.data?.items.map((c) => c.id) ?? [];
  // Complemento opcional: se falhar, a lista continua funcionando sem as colunas de histórico.
  const stats = useQuery({
    queryKey: [...contactKeys.all, "stats", ids],
    queryFn: () => fetchContactStats(ids),
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader title="Contatos" description="Pessoas que já falaram com a empresa pelo WhatsApp." />
      <div className="space-y-4 p-6">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <Input
            className="pl-9"
            placeholder="Buscar por nome, número ou empresa"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Card className="p-0">
          {query.isLoading ? (
            <div className="flex justify-center p-8">
              <Spinner />
            </div>
          ) : query.isError ? (
            <p className="p-6 text-sm text-danger">{errorMessage(query.error)}</p>
          ) : query.data!.items.length === 0 ? (
            <EmptyState icon={BookUser} title="Nenhum contato encontrado" />
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-ink-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Nome</th>
                  <th className="px-5 py-3 font-medium">Número</th>
                  <th className="px-5 py-3 font-medium">Empresa / Produto</th>
                  <th className="px-5 py-3 text-right font-medium">Atendimentos</th>
                  <th className="px-5 py-3 font-medium">Último contato</th>
                  <th className="px-5 py-3"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {query.data!.items.map((contact) => (
                  <tr key={contact.id}>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                          {initials(contact.name)}
                        </span>
                        {contact.name}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-ink-muted">{formatPhone(contact.number)}</td>
                    <td className="px-5 py-3">
                      {contact.clientCompany || contact.product ? (
                        <span className="flex flex-col">
                          <span>{contact.clientCompany ?? "—"}</span>
                          {contact.product && <span className="text-xs text-ink-muted">{contact.product}</span>}
                        </span>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <ContactHistoryCells stats={stats.data?.find((x) => x.id === contact.id)} />
                    <td className="px-5 py-3 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Editar ${contact.name}`}
                        onClick={() => setEditing(contact)}
                      >
                        Editar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm text-ink-muted">Página {page}</span>
          <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!query.data?.hasMore}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      </div>
      {editing && <EditContactDialog contact={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const ACTIVE_LABEL = { bot: "No bot", pending: "Aguardando", open: "Em atendimento" } as const;

function ContactHistoryCells({ stats }: { stats?: ContactStats }) {
  if (!stats) {
    return (
      <>
        <td className="px-5 py-3 text-right text-ink-muted">—</td>
        <td className="px-5 py-3 text-ink-muted">—</td>
      </>
    );
  }
  return (
    <>
      <td className="px-5 py-3 text-right tabular-nums">{stats.tickets}</td>
      <td className="px-5 py-3 text-ink-muted">
        <span className="flex items-center gap-2">
          {stats.lastContactAt ? timeAgo(stats.lastContactAt) : "—"}
          {stats.activeStatus && <Badge tone={stats.activeStatus === "open" ? "success" : "warning"}>{ACTIVE_LABEL[stats.activeStatus]}</Badge>}
        </span>
      </td>
    </>
  );
}
