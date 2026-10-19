import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import type { PartnerWithKey } from "./adminApi";

/** Chave do parceiro: aparece uma única vez (ao criar ou regenerar). */
export function PartnerKeyDialog({ created, onClose }: { created: PartnerWithKey; onClose: () => void }) {
  const { key, partner } = created;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="Chave do parceiro" description={`Configure esta chave no servidor de ${partner.name}.`}>
        <div className="flex items-start gap-2 rounded-lg border border-border bg-background p-4">
          <code className="min-w-0 flex-1 break-all font-mono text-sm font-semibold" data-testid="partner-key">
            {key}
          </code>
          <button
            type="button"
            aria-label="Copiar chave"
            className="shrink-0 rounded p-1 text-ink-muted hover:bg-primary-soft"
            onClick={() => {
              void navigator.clipboard?.writeText(key).then(() => toast.success("Chave copiada"), () => undefined);
            }}
          >
            <Copy className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <p className="mt-3 text-sm font-medium text-danger">Guarde agora: ela não será mostrada de novo.</p>
        <p className="mt-1 text-xs text-ink-muted">
          A chave fica só no servidor do parceiro, cifrada; nunca no navegador do cliente. Se ela vazar, regenere: a
          anterior para de valer na hora.
        </p>
        <DialogFooter>
          <Button onClick={onClose}>Já guardei</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
