import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/apiError";
import type { Queue, WeekSchedule } from "@/types/api";
import { createQueue, queueKeys, updateQueue } from "./queuesApi";
import { ScheduleEditor } from "./ScheduleEditor";
import { validateSchedule } from "./schedule";

export function QueueDialog({ queue, onClose }: { queue?: Queue; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(queue?.name ?? "");
  const [color, setColor] = useState(queue?.color ?? "#0a6ad6");
  const [schedule, setSchedule] = useState<WeekSchedule>(queue?.schedule ?? {});
  const scheduleError = validateSchedule(schedule);

  const mutation = useMutation({
    mutationFn: () => {
      const input = { name: name.trim(), color, schedule };
      return queue ? updateQueue(queue.id, input) : createQueue(input);
    },
    onSuccess: () => {
      toast.success(queue ? "Fila atualizada" : "Fila criada");
      void queryClient.invalidateQueries({ queryKey: queueKeys.all });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={queue ? "Editar fila" : "Nova fila"} className="max-w-2xl">
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="flex gap-4">
            <div className="flex-1">
              <Label htmlFor="queue-name">Nome</Label>
              <Input id="queue-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            </div>
            <div>
              <Label htmlFor="queue-color">Cor</Label>
              <Input
                id="queue-color"
                type="color"
                className="w-16 p-1"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium">Horário de expediente</p>
            <ScheduleEditor value={schedule} onChange={setSchedule} />
            {scheduleError && (
              <p role="alert" className="mt-2 text-sm text-danger">
                {scheduleError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={!name.trim() || Boolean(scheduleError)}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
