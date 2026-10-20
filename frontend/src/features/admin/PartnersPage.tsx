import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, KeyRound, Pencil, Plus, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/apiError";
import type { AdminPartner } from "@/types/api";
import {
  adminKeys,
  createPartner,
  fetchPartners,
  regeneratePartnerKey,
  setPartnerRevoked,
  updatePartner,
  type PartnerWithKey,
} from "./adminApi";
import { PartnerKeyDialog } from "./PartnerKeyDialog";

const formatDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "nunca";

function PartnerDialog({
  partner,
  onClose,
  onCreated,
}: {
  partner?: AdminPartner;
  onClose: () => void;
  onCreated: (created: PartnerWithKey) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(partner?.name ?? "");
  const mutation = useMutation({
    mutationFn: (): Promise<AdminPartner | PartnerWithKey> =>
      partner ? updatePartner(partner.id, name.trim()) : createPartner(name.trim()),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.partners });
      onClose();
      if (partner) toast.success("Parceiro atualizado");
      else onCreated(saved as PartnerWithKey);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={partner ? "Editar parceiro" : "Novo parceiro"}>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div>
            <Label htmlFor="partner-name">Nome do sistema</Label>
            <Input id="partner-name" placeholder="MultiComércio" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
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

/** Sistemas parceiros que criam empresas e conexões pela API de parceiros. */
export function PartnersPage() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const partners = useQuery({ queryKey: adminKeys.partners, queryFn: fetchPartners });
  const [dialog, setDialog] = useState<{ partner?: AdminPartner } | null>(null);
  const [shownKey, setShownKey] = useState<PartnerWithKey | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: adminKeys.partners });

  const regenerate = useMutation({
    mutationFn: (partner: AdminPartner) => regeneratePartnerKey(partner.id),
    onSuccess: (result) => {
      refresh();
      setShownKey(result);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const toggle = useMutation({
    mutationFn: (partner: AdminPartner) => setPartnerRevoked(partner.id, partner.status === "active"),
    onSuccess: (partner) => {
      refresh();
      toast.success(partner.status === "revoked" ? "Parceiro revogado" : "Parceiro reativado");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  async function onRegenerate(partner: AdminPartner) {
    const ok = await confirm({
      title: "Regenerar chave",
      description: `A chave atual de ${partner.name} para de valer na hora. O sistema dele só volta a criar empresas depois de configurado com a nova chave.`,
      confirmLabel: "Regenerar",
      danger: true,
    });
    if (ok) regenerate.mutate(partner);
  }

  async function onToggle(partner: AdminPartner) {
    const revoking = partner.status === "active";
    const ok = await confirm(
      revoking
        ? {
            title: "Revogar parceiro",
            description: `${partner.name} não poderá mais criar empresas nem obter tokens. As empresas já criadas continuam enviando; para pará-las, bloqueie-as em Empresas.`,
            confirmLabel: "Revogar",
            danger: true,
          }
        : {
            title: "Reativar parceiro",
            description: `${partner.name} volta a usar a API de parceiros com a chave atual.`,
            confirmLabel: "Reativar",
          },
    );
    if (ok) toggle.mutate(partner);
  }

  function renderActions(partner: AdminPartner) {
    const active = partner.status === "active";
    return (
      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
        <Button variant="ghost" size="icon" aria-label={`Editar ${partner.name}`} onClick={() => setDialog({ partner })}>
          <Pencil className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Regenerar chave de ${partner.name}`}
          title="Regenerar chave"
          onClick={() => void onRegenerate(partner)}
        >
          <KeyRound className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`${active ? "Revogar" : "Reativar"} ${partner.name}`}
          title={active ? "Revogar" : "Reativar"}
          onClick={() => void onToggle(partner)}
        >
          {active ? <Ban className="h-4 w-4" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
        </Button>
      </div>
    );
  }

  const cols = "md:grid-cols-[minmax(0,2fr)_8rem_7rem_6rem_9rem_7.5rem]";
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Parceiros"
        description="Sistemas que criam empresas e conexões pela API de parceiros."
        actions={
          <Button onClick={() => setDialog({})}>
            <Plus className="h-4 w-4" aria-hidden /> Novo parceiro
          </Button>
        }
      />
      <div className="p-4 sm:p-6">
        <Card className="p-0">
          {partners.isLoading ? (
            <div className="flex justify-center p-8">
              <Spinner />
            </div>
          ) : partners.isError ? (
            <p className="p-6 text-sm text-danger">{errorMessage(partners.error)}</p>
          ) : partners.data!.length === 0 ? (
            <p className="p-6 text-sm text-ink-muted">Nenhum parceiro cadastrado.</p>
          ) : (
            <div role="table" aria-label="Parceiros" className="text-sm">
              <div role="row" className={`hidden border-b border-border px-5 py-3 text-ink-muted md:grid md:gap-4 ${cols}`}>
                <span role="columnheader" className="font-medium">Parceiro</span>
                <span role="columnheader" className="font-medium">Chave</span>
                <span role="columnheader" className="font-medium">Situação</span>
                <span role="columnheader" className="font-medium">Empresas</span>
                <span role="columnheader" className="font-medium">Último uso</span>
                <span role="columnheader" className="sr-only">Ações</span>
              </div>
              <div className="divide-y divide-border">
                {partners.data!.map((partner) => (
                  <div
                    key={partner.id}
                    role="row"
                    className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 p-4 md:items-center md:gap-4 md:px-5 md:py-3 ${cols}`}
                  >
                    <span role="cell" className="min-w-0 break-words font-medium">
                      {partner.name}
                    </span>
                    <span role="cell" className="justify-self-end font-mono text-xs text-ink-muted md:justify-self-start">
                      {partner.keyPrefix}…
                    </span>
                    <span role="cell">
                      <Badge tone={partner.status === "active" ? "success" : "danger"}>
                        {partner.status === "active" ? "Ativo" : "Revogado"}
                      </Badge>
                    </span>
                    <span role="cell" className="justify-self-end text-xs text-ink-muted md:justify-self-start md:text-sm">
                      {partner.companyCount}
                      <span className="md:hidden"> {partner.companyCount === 1 ? "empresa" : "empresas"}</span>
                    </span>
                    <span role="cell" className="text-xs text-ink-muted md:text-sm">
                      <span className="md:hidden">último uso </span>
                      {formatDateTime(partner.lastUsedAt)}
                    </span>
                    <span role="cell" className="justify-self-end md:col-span-1">
                      {renderActions(partner)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
      {dialog && <PartnerDialog partner={dialog.partner} onClose={() => setDialog(null)} onCreated={setShownKey} />}
      {shownKey && <PartnerKeyDialog created={shownKey} onClose={() => setShownKey(null)} />}
    </div>
  );
}
