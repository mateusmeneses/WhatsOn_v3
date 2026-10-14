import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { useQueues } from "@/features/queues/useQueues";
import { useUserOptions } from "@/features/users/useUserOptions";
import { errorMessage } from "@/lib/apiError";
import { useAuth } from "@/stores/auth";
import type { Ticket } from "@/types/api";
import { transferTicket } from "./ticketsApi";

type Mode = "queue" | "user";

export function TransferDialog({
  ticket,
  open,
  onOpenChange,
  onTransferred,
}: {
  ticket: Ticket;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTransferred: (ticket: Ticket) => void;
}) {
  const me = useAuth((s) => s.user)!;
  const [mode, setMode] = useState<Mode>("queue");
  const [queueId, setQueueId] = useState("");
  const [userId, setUserId] = useState("");
  const queues = useQueues();
  const users = useUserOptions();

  const mutation = useMutation({
    mutationFn: () =>
      transferTicket(ticket.id, mode === "queue" ? { queueId: Number(queueId) } : { userId: Number(userId) }),
    onSuccess: (updated) => {
      toast.success("Atendimento transferido");
      onOpenChange(false);
      onTransferred(updated);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const ready = mode === "queue" ? queueId !== "" : userId !== "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Transferir atendimento" description="Escolha para onde este atendimento deve ir.">
        <Tabs<Mode>
          value={mode}
          onChange={setMode}
          items={[
            { value: "queue", label: "Para uma fila" },
            { value: "user", label: "Para um atendente" },
          ]}
        />
        <div className="mt-4">
          {mode === "queue" ? (
            <>
              <Label htmlFor="transfer-queue">Fila</Label>
              <Select id="transfer-queue" value={queueId} onChange={(e) => setQueueId(e.target.value)}>
                <option value="">Selecione…</option>
                {queues.data
                  ?.filter((q) => q.id !== ticket.queueId)
                  .map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name}
                    </option>
                  ))}
              </Select>
            </>
          ) : (
            <>
              <Label htmlFor="transfer-user">Atendente</Label>
              <Select id="transfer-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Selecione…</option>
                {users.data
                  ?.filter((u) => u.id !== me.id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </Select>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!ready} loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Transferir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
