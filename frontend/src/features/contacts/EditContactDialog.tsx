import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/apiError";
import type { Contact } from "@/types/api";
import { contactKeys, updateContact } from "./contactsApi";

export function EditContactDialog({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(contact.name);
  const mutation = useMutation({
    mutationFn: () => updateContact(contact.id, { name: name.trim() }),
    onSuccess: () => {
      toast.success("Contato atualizado");
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
      // tickets embutem o contato (nome na lista e no cabeçalho do chat)
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="Editar contato">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <Label htmlFor="contact-name">Nome</Label>
          <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={!name.trim()}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
