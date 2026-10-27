import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ContactManagerFields, type Linked } from "@/features/manager/ContactManagerFields";
import { useManagerEnabled } from "@/features/manager/managerApi";
import { errorMessage } from "@/lib/apiError";
import type { Contact } from "@/types/api";
import { contactKeys, updateContact } from "./contactsApi";

export function EditContactDialog({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const queryClient = useQueryClient();
  const managerEnabled = useManagerEnabled();
  const [name, setName] = useState(contact.name);
  const [client, setClient] = useState<Linked>({ id: contact.managerClientId, name: contact.clientCompany ?? "" });
  const [product, setProduct] = useState<Linked>({ id: contact.managerProductId, name: contact.product ?? "" });
  const mutation = useMutation({
    mutationFn: () =>
      updateContact(contact.id, {
        name: name.trim(),
        clientCompany: client.name.trim() || null,
        managerClientId: client.id,
        product: product.name.trim() || null,
        managerProductId: product.id,
      }),
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
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div>
            <Label htmlFor="contact-name">Nome</Label>
            <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {managerEnabled ? (
            <ContactManagerFields
              contactId={contact.id}
              client={client}
              product={product}
              onClientChange={setClient}
              onProductChange={setProduct}
            />
          ) : (
            <>
              <div>
                <Label htmlFor="contact-client">Empresa</Label>
                <Input
                  id="contact-client"
                  maxLength={200}
                  value={client.name}
                  onChange={(e) => setClient({ id: null, name: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="contact-product">Produto</Label>
                <Input
                  id="contact-product"
                  maxLength={200}
                  value={product.name}
                  onChange={(e) => setProduct({ id: null, name: e.target.value })}
                />
              </div>
            </>
          )}
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
