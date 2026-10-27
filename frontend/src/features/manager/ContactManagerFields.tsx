import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { fetchManagerCatalog, fetchManagerClients, managerKeys, type ManagerClient } from "./managerApi";

/** Valor vinculado ao Manager: código (null = sem vínculo) e o nome mostrado no WhatsOn. */
export interface Linked {
  id: number | null;
  name: string;
}

const clientLabel = (c: ManagerClient) => [c.nome, c.fantasia, c.cnpj].filter(Boolean).join(" | ");

/** Empresa (cliente do Manager, sugerido pelo telefone do contato ou buscado) e produto (catálogo do Manager). */
export function ContactManagerFields({
  contactId,
  client,
  product,
  onClientChange,
  onProductChange,
}: {
  contactId: number;
  client: Linked;
  product: Linked;
  onClientChange: (value: Linked) => void;
  onProductChange: (value: Linked) => void;
}) {
  const [search, setSearch] = useState("");
  const q = search.trim();
  const searching = q.length >= 2;

  const clients = useQuery({
    queryKey: [...managerKeys.clients(null, searching ? q : ""), contactId],
    queryFn: () => fetchManagerClients(searching ? { q } : { contactId }),
  });
  const catalog = useQuery({ queryKey: managerKeys.catalog, queryFn: fetchManagerCatalog, staleTime: 5 * 60_000 });

  const list = clients.data ?? [];
  // A empresa já salva continua na lista mesmo quando a busca não a traz.
  const savedMissing = client.id !== null && !list.some((c) => c.cod_cliente === client.id);
  const produtos = catalog.data?.produtos ?? [];
  const productMissing = product.id !== null && !produtos.some((p) => p.cod_produto === product.id);

  return (
    <>
      <div>
        <Label htmlFor="contact-client-search">Empresa</Label>
        <Input
          id="contact-client-search"
          placeholder="Buscar no Manager por nome, fantasia ou CNPJ"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          aria-label="Empresa no Manager"
          className="mt-2"
          value={client.id ?? ""}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            const picked = list.find((c) => c.cod_cliente === id);
            onClientChange(id === null ? { id: null, name: "" } : { id, name: picked?.nome ?? client.name });
          }}
        >
          <option value="">{clients.isLoading ? "Buscando…" : "Sem empresa"}</option>
          {savedMissing && <option value={client.id!}>{client.name}</option>}
          {list.map((c) => (
            <option key={c.cod_cliente} value={c.cod_cliente}>
              {clientLabel(c)}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="contact-product">Produto</Label>
        <Select
          id="contact-product"
          value={product.id ?? ""}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            const picked = produtos.find((p) => p.cod_produto === id);
            onProductChange(id === null ? { id: null, name: "" } : { id, name: picked?.descricao ?? product.name });
          }}
        >
          <option value="">Sem produto</option>
          {productMissing && <option value={product.id!}>{product.name}</option>}
          {produtos.map((p) => (
            <option key={p.cod_produto} value={p.cod_produto}>
              {p.descricao}
            </option>
          ))}
        </Select>
      </div>
    </>
  );
}
