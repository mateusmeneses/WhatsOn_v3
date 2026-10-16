import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import type { CreatedCompany } from "./adminApi";

/** Acesso do primeiro admin: a senha temporária aparece uma única vez. */
export function CreatedCompanyDialog({ created, onClose }: { created: CreatedCompany; onClose: () => void }) {
  const password = created.temporaryPassword;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Empresa criada"
        description={`Repasse o acesso de ${created.admin.name}, administrador de ${created.company.name}.`}
      >
        <dl className="space-y-2 rounded-lg border border-border bg-background p-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="shrink-0 text-ink-muted">Usuário</dt>
            <dd className="min-w-0 break-all text-right font-medium">{created.admin.email}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="shrink-0 text-ink-muted">Senha temporária</dt>
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
        <p className="mt-3 text-xs text-ink-muted">
          No primeiro acesso será obrigatório cadastrar uma nova senha. Depois de conectar o WhatsApp da empresa, o acesso
          também pode ser reenviado pela tela de Usuários.
        </p>
        <DialogFooter>
          <Button onClick={onClose}>Entendi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
