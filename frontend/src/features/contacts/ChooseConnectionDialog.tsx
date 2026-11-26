import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { STATUS_LABEL } from "@/features/connections/connectionsApi";
import { useConnections } from "@/features/connections/useConnections";
import type { Contact } from "@/types/api";

/** Contato sem histórico e empresa com mais de uma conexão: o usuário escolhe por qual número falar. */
export function ChooseConnectionDialog({
  contact,
  loading,
  onChoose,
  onClose,
}: {
  contact: Contact;
  loading: boolean;
  onChoose: (connectionId: number) => void;
  onClose: () => void;
}) {
  const connections = useConnections();
  const [selected, setSelected] = useState<number | null>(null);
  const list = connections.data ?? [];
  const value = selected ?? list.find((c) => c.status === "connected")?.id ?? list[0]?.id ?? null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={`Conversar com ${contact.name}`}>
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (value) onChoose(value);
          }}
        >
          {connections.isLoading ? (
            <div className="flex justify-center p-4">
              <Spinner />
            </div>
          ) : (
            <div>
              <Label htmlFor="conversation-connection">Conexão</Label>
              <Select
                id="conversation-connection"
                value={value ?? ""}
                onChange={(e) => setSelected(Number(e.target.value))}
              >
                {list.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.status !== "connected" ? ` (${STATUS_LABEL[c.status]})` : ""}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={loading} disabled={!value}>
              Abrir conversa
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
