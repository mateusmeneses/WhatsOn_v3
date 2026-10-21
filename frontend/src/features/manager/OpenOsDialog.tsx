import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/apiError";
import { ticketKeys } from "@/features/tickets/ticketsApi";
import { useApplyTicket } from "@/features/tickets/useTickets";
import type { Ticket } from "@/types/api";
import { ManagerClientFields, type ClientChoice } from "./ManagerClientFields";
import { fetchManagerCatalog, managerKeys, openManagerOs, ticketSummaryText } from "./managerApi";

/** Abre uma OS no Manager a partir do atendimento (cliente sugerido pelo telefone do contato). */
export function OpenOsDialog({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const queryClient = useQueryClient();
  const applyTicket = useApplyTicket();
  const catalog = useQuery({ queryKey: managerKeys.catalog, queryFn: fetchManagerCatalog, staleTime: 5 * 60_000 });
  const [client, setClient] = useState<ClientChoice>({});
  const [titulo, setTitulo] = useState(ticket.botPath ? `Suporte: ${ticket.botPath}` : "");
  const [descricao, setDescricao] = useState(ticketSummaryText(ticket));
  const [prioridade, setPrioridade] = useState(2);

  const mutation = useMutation({
    mutationFn: () =>
      openManagerOs(ticket.id, {
        titulo: titulo.trim(),
        descricao,
        prioridade,
        codCliente: client.codCliente!,
        codSolicitante: client.codSolicitante,
      }),
    onSuccess: (updated) => {
      applyTicket(updated);
      void queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
      toast.success(`OS #${updated.managerOsId} aberta no Manager`);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="Abrir OS no Manager" description="A OS é criada no Kanban do Manager e o responsável é avisado." className="max-w-xl">
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <ManagerClientFields ticketId={ticket.id} value={client} onChange={setClient} />
          <div>
            <Label htmlFor="os-titulo">Título</Label>
            <Input id="os-titulo" maxLength={200} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="os-descricao">Descrição</Label>
            <Textarea id="os-descricao" rows={6} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="os-prioridade">Prioridade</Label>
            <Select id="os-prioridade" value={prioridade} onChange={(e) => setPrioridade(Number(e.target.value))}>
              {(catalog.data?.prioridades_os ?? [{ id: 2, nome: "Média" }]).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </Select>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={!titulo.trim() || client.codCliente === undefined}>
              Abrir OS
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
