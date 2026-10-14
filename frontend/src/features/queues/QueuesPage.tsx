import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/apiError";
import type { Queue } from "@/types/api";
import { QueueDialog } from "./QueueDialog";
import { deleteQueue, queueKeys } from "./queuesApi";
import { useQueues } from "./useQueues";
import { describeSchedule } from "./schedule";

export function QueuesPage() {
  const queryClient = useQueryClient();
  const queues = useQueues();
  const [dialog, setDialog] = useState<{ queue?: Queue } | null>(null);

  const remove = useMutation({
    mutationFn: (id: number) => deleteQueue(id),
    onSuccess: () => {
      toast.success("Fila excluída");
      void queryClient.invalidateQueries({ queryKey: queueKeys.all });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Filas"
        description="Setores que recebem os atendimentos, com horário de expediente."
        actions={
          <Button onClick={() => setDialog({})}>
            <Plus className="h-4 w-4" aria-hidden /> Nova fila
          </Button>
        }
      />
      <div className="p-6">
        {queues.isLoading ? (
          <Spinner />
        ) : queues.isError ? (
          <p className="text-sm text-danger">{errorMessage(queues.error)}</p>
        ) : queues.data!.length === 0 ? (
          <EmptyState icon={Layers} title="Nenhuma fila cadastrada" description="Crie a primeira fila para organizar os atendimentos." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {queues.data!.map((queue) => (
              <Card key={queue.id} className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-3 w-3 rounded-full" style={{ backgroundColor: queue.color }} aria-hidden />
                  <div>
                    <p className="font-semibold">{queue.name}</p>
                    <p className="text-sm text-ink-muted">{describeSchedule(queue.schedule)}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Editar ${queue.name}`} onClick={() => setDialog({ queue })}>
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Excluir ${queue.name}`}
                    onClick={() => {
                      if (window.confirm(`Excluir a fila "${queue.name}"?`)) remove.mutate(queue.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
      {dialog && <QueueDialog queue={dialog.queue} onClose={() => setDialog(null)} />}
    </div>
  );
}
