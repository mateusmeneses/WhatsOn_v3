import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, LogIn, Pencil, Plus, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/apiError";
import { useAuth } from "@/stores/auth";
import type { AdminCompany } from "@/types/api";
import { adminKeys, enterCompany, fetchCompanies, setCompanyBlocked, type CreatedCompany } from "./adminApi";
import { CompanyDialog } from "./CompanyDialog";
import { CreatedCompanyDialog } from "./CreatedCompanyDialog";

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

function StatusBadge({ company }: { company: AdminCompany }) {
  const blocked = company.status === "blocked";
  return <Badge tone={blocked ? "danger" : "success"}>{blocked ? "Bloqueada" : "Ativa"}</Badge>;
}

export function CompaniesPage() {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const setSession = useAuth((s) => s.setSession);
  const queryClient = useQueryClient();
  const companies = useQuery({ queryKey: adminKeys.companies, queryFn: fetchCompanies });
  const [dialog, setDialog] = useState<{ company?: AdminCompany } | null>(null);
  const [created, setCreated] = useState<CreatedCompany | null>(null);

  const toggleBlock = useMutation({
    mutationFn: (company: AdminCompany) => setCompanyBlocked(company.id, company.status !== "blocked"),
    onSuccess: (company) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.companies });
      toast.success(company.status === "blocked" ? "Empresa bloqueada" : "Empresa desbloqueada");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const enter = useMutation({
    mutationFn: (company: AdminCompany) => enterCompany(company.id),
    onSuccess: (session) => {
      setSession(session);
      navigate("/atendimento", { replace: true });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  async function onToggleBlock(company: AdminCompany) {
    const blocked = company.status === "blocked";
    const ok = await confirm(
      blocked
        ? {
            title: "Desbloquear empresa",
            description: `${company.name} volta a acessar o sistema e a receber e enviar mensagens.`,
            confirmLabel: "Desbloquear",
          }
        : {
            title: "Bloquear empresa",
            description: `Os usuários de ${company.name} serão desconectados na hora e o WhatsApp para: mensagens recebidas durante o bloqueio são descartadas e nada é enviado.`,
            confirmLabel: "Bloquear",
            danger: true,
          },
    );
    if (ok) toggleBlock.mutate(company);
  }

  function renderActions(company: AdminCompany) {
    const blocked = company.status === "blocked";
    return (
      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
        <Button variant="ghost" size="icon" aria-label={`Editar ${company.name}`} onClick={() => setDialog({ company })}>
          <Pencil className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`${blocked ? "Desbloquear" : "Bloquear"} ${company.name}`}
          title={blocked ? "Desbloquear" : "Bloquear"}
          onClick={() => void onToggleBlock(company)}
        >
          {blocked ? <ShieldCheck className="h-4 w-4" aria-hidden /> : <Ban className="h-4 w-4" aria-hidden />}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="ml-1"
          aria-label={`Entrar em ${company.name}`}
          loading={enter.isPending && enter.variables?.id === company.id}
          onClick={() => enter.mutate(company)}
        >
          <LogIn className="h-4 w-4" aria-hidden /> Entrar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Empresas"
        description="Clientes da plataforma. Entre em uma empresa para administrá-la."
        actions={
          <Button onClick={() => setDialog({})}>
            <Plus className="h-4 w-4" aria-hidden /> Nova empresa
          </Button>
        }
      />
      <div className="p-4 sm:p-6">
        <Card className="p-0">
          {companies.isLoading ? (
            <div className="flex justify-center p-8">
              <Spinner />
            </div>
          ) : companies.isError ? (
            <p className="p-6 text-sm text-danger">{errorMessage(companies.error)}</p>
          ) : companies.data!.length === 0 ? (
            <p className="p-6 text-sm text-ink-muted">Nenhuma empresa cadastrada.</p>
          ) : (
            <div role="table" aria-label="Empresas" className="text-sm">
              <div role="row" className="hidden border-b border-border px-5 py-3 text-ink-muted md:grid md:grid-cols-[minmax(0,2fr)_7rem_6rem_7rem_auto] md:gap-4">
                <span role="columnheader" className="font-medium">Empresa</span>
                <span role="columnheader" className="font-medium">Situação</span>
                <span role="columnheader" className="font-medium">Usuários</span>
                <span role="columnheader" className="font-medium">Criada em</span>
                <span role="columnheader" className="sr-only">Ações</span>
              </div>
              <div className="divide-y divide-border">
                {companies.data!.map((company) => (
                  <div
                    key={company.id}
                    role="row"
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 p-4 md:grid-cols-[minmax(0,2fr)_7rem_6rem_7rem_auto] md:items-center md:gap-4 md:px-5 md:py-3"
                  >
                    <span role="cell" className="min-w-0 break-words font-medium">
                      {company.name}
                    </span>
                    <span role="cell" className="justify-self-end md:justify-self-start">
                      <StatusBadge company={company} />
                    </span>
                    <span role="cell" className="text-xs text-ink-muted md:text-sm">
                      {company.userCount}
                      <span className="md:hidden"> {company.userCount === 1 ? "usuário" : "usuários"}</span>
                    </span>
                    <span role="cell" className="justify-self-end text-xs text-ink-muted md:justify-self-start md:text-sm">
                      <span className="md:hidden">criada em </span>
                      {formatDate(company.createdAt)}
                    </span>
                    <span role="cell" className="col-span-2 md:col-span-1">
                      {renderActions(company)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
      {dialog && <CompanyDialog company={dialog.company} onClose={() => setDialog(null)} onCreated={setCreated} />}
      {created && <CreatedCompanyDialog created={created} onClose={() => setCreated(null)} />}
    </div>
  );
}
