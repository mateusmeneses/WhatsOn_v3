import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { Contact } from "@/types/api";
import { fetchManagerClients, fetchManagerContacts, managerKeys, type ManagerClient } from "./managerApi";

export interface ClientChoice {
  codCliente?: number;
  /** Nome do cliente no Manager, para guardar no contato. */
  nome?: string;
  codSolicitante?: number;
}

/** Empresa já cadastrada no contato: começa selecionada no lugar da sugestão pelo telefone. */
export function savedClientChoice(contact: Contact | undefined): ClientChoice {
  return contact?.managerClientId ? { codCliente: contact.managerClientId, nome: contact.clientCompany ?? undefined } : {};
}

const clientLabel = (c: ManagerClient) => [c.nome, c.fantasia, c.cnpj].filter(Boolean).join(" | ");

/** Cliente (sugerido pelo telefone do contato ou buscado pelo nome) e solicitante do Manager. */
export function ManagerClientFields({
  ticketId,
  value,
  onChange,
}: {
  ticketId: number;
  value: ClientChoice;
  onChange: (value: ClientChoice) => void;
}) {
  const [search, setSearch] = useState("");
  const q = search.trim();
  const searching = q.length >= 2;

  const clients = useQuery({
    queryKey: managerKeys.clients(searching ? null : ticketId, searching ? q : ""),
    queryFn: () => fetchManagerClients(searching ? { q } : { ticketId }),
  });
  const list = clients.data ?? [];
  // A empresa salva no contato continua selecionável mesmo quando a busca não a traz.
  const savedMissing = value.codCliente !== undefined && !list.some((c) => c.cod_cliente === value.codCliente);

  // Um único cliente sugerido já vem selecionado (com o contato que casou pelo telefone).
  useEffect(() => {
    if (value.codCliente === undefined && list.length === 1) {
      onChange({ codCliente: list[0]!.cod_cliente, nome: list[0]!.nome, codSolicitante: list[0]!.contato?.cod_contato });
    }
  }, [list, value.codCliente, onChange]);

  const contacts = useQuery({
    queryKey: managerKeys.contacts(value.codCliente ?? 0),
    queryFn: () => fetchManagerContacts(value.codCliente!),
    enabled: value.codCliente !== undefined,
  });

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="mgr-search">Cliente no Manager</Label>
        <Input
          id="mgr-search"
          placeholder="Buscar por nome, fantasia ou CNPJ (opcional)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          aria-label="Cliente"
          className="mt-2"
          value={value.codCliente ?? ""}
          onChange={(e) => {
            const codCliente = e.target.value ? Number(e.target.value) : undefined;
            const picked = list.find((c) => c.cod_cliente === codCliente);
            onChange({ codCliente, nome: picked?.nome ?? value.nome, codSolicitante: picked?.contato?.cod_contato });
          }}
        >
          <option value="">
            {clients.isLoading ? "Buscando…" : list.length === 0 ? "Nenhum cliente encontrado — use a busca" : "Selecione o cliente"}
          </option>
          {savedMissing && <option value={value.codCliente}>{value.nome ?? `Cliente ${value.codCliente}`}</option>}
          {list.map((c) => (
            <option key={c.cod_cliente} value={c.cod_cliente}>
              {clientLabel(c)}
            </option>
          ))}
        </Select>
      </div>
      {value.codCliente !== undefined && (
        <div>
          <Label htmlFor="mgr-solicitante">Técnico</Label>
          <Select
            id="mgr-solicitante"
            value={value.codSolicitante ?? ""}
            onChange={(e) => onChange({ ...value, codSolicitante: e.target.value ? Number(e.target.value) : undefined })}
          >
            <option value="">Sem técnico</option>
            {(contacts.data ?? []).map((c) => (
              <option key={c.cod_contato} value={c.cod_contato}>
                {c.nome}
              </option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );
}
