import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useQueues } from "@/features/queues/useQueues";
import { errorMessage } from "@/lib/apiError";
import type { Connection } from "@/types/api";
import {
  connectionKeys,
  createConnection,
  DEFAULT_OUT_OF_HOURS_MESSAGE,
  DEFAULT_TRANSFER_MESSAGE,
  updateConnection,
  type ConnectionInput,
} from "./connectionsApi";

export function ConnectionDialog({
  connection,
  onClose,
  onCreated,
}: {
  connection?: Connection;
  onClose: () => void;
  onCreated?: (connection: Connection) => void;
}) {
  const queryClient = useQueryClient();
  const queues = useQueues();
  const [name, setName] = useState(connection?.name ?? "");
  const [defaultQueueId, setDefaultQueueId] = useState(connection?.defaultQueueId ? String(connection.defaultQueueId) : "");
  const [isDefault, setIsDefault] = useState(connection?.isDefault ?? false);
  const [transferMessage, setTransferMessage] = useState(connection?.transferMessage ?? DEFAULT_TRANSFER_MESSAGE);
  const [outOfHoursMessage, setOutOfHoursMessage] = useState(connection?.outOfHoursMessage ?? DEFAULT_OUT_OF_HOURS_MESSAGE);
  const [closingMessage, setClosingMessage] = useState(connection?.closingMessage ?? "");
  const [botTimeoutMinutes, setBotTimeoutMinutes] = useState(String(connection?.botTimeoutMinutes ?? 30));

  const timeout = Number(botTimeoutMinutes);
  const valid = name.trim() !== "" && Number.isInteger(timeout) && timeout >= 1 && timeout <= 1440;

  const mutation = useMutation({
    mutationFn: () => {
      const input: ConnectionInput = {
        name: name.trim(),
        isDefault,
        defaultQueueId: defaultQueueId ? Number(defaultQueueId) : null,
        transferMessage,
        outOfHoursMessage,
        closingMessage,
        botTimeoutMinutes: timeout,
      };
      return connection ? updateConnection(connection.id, input) : createConnection(input);
    },
    onSuccess: (saved) => {
      toast.success(connection ? "Conexão atualizada" : "Conexão criada");
      void queryClient.invalidateQueries({ queryKey: connectionKeys.all });
      onClose();
      if (!connection) onCreated?.(saved);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={connection ? "Editar conexão" : "Nova conexão"} className="max-w-xl">
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div>
            <Label htmlFor="conn-name">Nome</Label>
            <Input id="conn-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="conn-queue">Fila padrão</Label>
              <Select id="conn-queue" value={defaultQueueId} onChange={(e) => setDefaultQueueId(e.target.value)}>
                <option value="">Nenhuma</option>
                {queues.data?.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="conn-timeout">Tempo limite do bot (minutos)</Label>
              <Input
                id="conn-timeout"
                type="number"
                min={1}
                max={1440}
                value={botTimeoutMinutes}
                onChange={(e) => setBotTimeoutMinutes(e.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-primary)]"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            Conexão padrão da empresa
          </label>
          <div>
            <Label htmlFor="conn-transfer">Mensagem de transferência</Label>
            <Textarea id="conn-transfer" rows={2} value={transferMessage} onChange={(e) => setTransferMessage(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="conn-hours">Mensagem fora do expediente</Label>
            <Textarea id="conn-hours" rows={2} value={outOfHoursMessage} onChange={(e) => setOutOfHoursMessage(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="conn-closing">Mensagem de encerramento</Label>
            <Textarea
              id="conn-closing"
              rows={2}
              placeholder="Opcional — enviada ao finalizar o atendimento"
              value={closingMessage}
              onChange={(e) => setClosingMessage(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={!valid}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
