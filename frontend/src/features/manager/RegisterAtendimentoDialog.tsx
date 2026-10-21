import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/apiError";
import { useApplyTicket } from "@/features/tickets/useTickets";
import type { Ticket } from "@/types/api";
import { ManagerClientFields, type ClientChoice } from "./ManagerClientFields";
import { fetchManagerCatalog, managerKeys, normalize, registerManagerAtendimento } from "./managerApi";

export const ATENDIMENTO_DESCRIPTION_MAX = 500;

/** Sistema escolhido pelo cliente no menu do bot (último item do caminho) casado com a descrição do produto. */
export function suggestProduct(botPath: string | null, produtos: { cod_produto: number; descricao: string }[]): number | undefined {
  const last = botPath?.split("›").pop();
  if (!last) return undefined;
  const wanted = normalize(last).replace(/\(.*\)/, "").trim();
  if (!wanted) return undefined;
  const exact = produtos.find((p) => normalize(p.descricao) === normalize(last));
  return (exact ?? produtos.find((p) => normalize(p.descricao).includes(wanted)))?.cod_produto;
}

/** Registra o atendimento no Manager (cliente, produto, datas do atendimento e descrição). */
export function RegisterAtendimentoDialog({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const applyTicket = useApplyTicket();
  const catalog = useQuery({ queryKey: managerKeys.catalog, queryFn: fetchManagerCatalog, staleTime: 5 * 60_000 });
  const [client, setClient] = useState<ClientChoice>({});
  const [produto, setProduto] = useState<number | undefined>();
  const [tipo, setTipo] = useState<number | undefined>();
  const [prioridade, setPrioridade] = useState(2);
  const [descricao, setDescricao] = useState(
    [ticket.botPath, ticket.notes].filter(Boolean).join(" — ").slice(0, ATENDIMENTO_DESCRIPTION_MAX),
  );

  const produtos = catalog.data?.produtos ?? [];
  const selectedProduto = produto ?? suggestProduct(ticket.botPath, produtos);

  const mutation = useMutation({
    mutationFn: () =>
      registerManagerAtendimento(ticket.id, {
        codCliente: client.codCliente!,
        codSolicitante: client.codSolicitante,
        codProduto: selectedProduto,
        codTipoAtendimento: tipo,
        prioridade,
        descricao: descricao.trim(),
      }),
    onSuccess: (updated) => {
      applyTicket(updated);
      toast.success(`Atendimento #${updated.managerAtendimentoId} registrado no Manager`);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="Registrar atendimento no Manager" description="Abertura e fim vêm deste atendimento." className="max-w-xl">
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <ManagerClientFields ticketId={ticket.id} value={client} onChange={setClient} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="at-produto">Produto</Label>
              <Select
                id="at-produto"
                value={selectedProduto ?? ""}
                onChange={(e) => setProduto(e.target.value ? Number(e.target.value) : undefined)}
              >
                <option value="">Sem produto</option>
                {produtos.map((p) => (
                  <option key={p.cod_produto} value={p.cod_produto}>
                    {p.descricao}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="at-tipo">Tipo</Label>
              <Select id="at-tipo" value={tipo ?? ""} onChange={(e) => setTipo(e.target.value ? Number(e.target.value) : undefined)}>
                <option value="">Padrão</option>
                {(catalog.data?.tipos_atendimento ?? []).map((t) => (
                  <option key={t.cod_tipo_atendimento} value={t.cod_tipo_atendimento}>
                    {t.descricao}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="at-prioridade">Prioridade</Label>
            <Select id="at-prioridade" value={prioridade} onChange={(e) => setPrioridade(Number(e.target.value))}>
              {(catalog.data?.prioridades_atendimento ?? [{ id: 2, nome: "Média" }]).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="at-descricao">Descrição</Label>
            <Textarea
              id="at-descricao"
              rows={5}
              maxLength={ATENDIMENTO_DESCRIPTION_MAX}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
            <p className="mt-1 text-right text-xs text-ink-muted">
              {descricao.length}/{ATENDIMENTO_DESCRIPTION_MAX}
            </p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Agora não
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={!descricao.trim() || client.codCliente === undefined}>
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
