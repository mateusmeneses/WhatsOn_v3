import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import type { UserWithAccess } from "./usersApi";

/** Mostrada só quando o acesso não chegou por WhatsApp: a senha temporária aparece uma única vez. */
export function AccessResultDialog({ user, onClose }: { user: UserWithAccess; onClose: () => void }) {
  const password = user.access.temporaryPassword!;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Acesso não enviado"
        description={
          user.phone
            ? "Não foi possível enviar o acesso pelo WhatsApp. Repasse os dados abaixo ao usuário."
            : "O usuário não tem telefone cadastrado. Repasse os dados abaixo a ele."
        }
      >
        <dl className="space-y-2 rounded-lg border border-border bg-background p-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Usuário</dt>
            <dd className="font-medium">{user.email}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-ink-muted">Senha temporária</dt>
            <dd className="flex items-center gap-2 font-mono font-semibold" data-testid="temporary-password">
              {password}
              <button
                type="button"
                aria-label="Copiar senha"
                className="rounded p-1 text-ink-muted hover:bg-primary-soft"
                onClick={() => {
                  void navigator.clipboard?.writeText(password).then(() => toast.success("Senha copiada"), () => undefined);
                }}
              >
                <Copy className="h-4 w-4" aria-hidden />
              </button>
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-ink-muted">No primeiro acesso o usuário será obrigado a cadastrar uma nova senha.</p>
        <DialogFooter>
          <Button onClick={onClose}>Entendi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
