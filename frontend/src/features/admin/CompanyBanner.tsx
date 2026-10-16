import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { companyKeys, fetchCompany } from "@/features/settings/companyApi";
import { errorMessage } from "@/lib/apiError";
import { useAuth } from "@/stores/auth";
import { exitCompany } from "./adminApi";

/** Faixa do super-admin dentro de uma empresa: qual empresa é e como sair dela. */
export function CompanyBanner() {
  const user = useAuth((s) => s.user);
  const setSession = useAuth((s) => s.setSession);
  const navigate = useNavigate();
  const acting = Boolean(user?.superAdmin && user.companyId !== null);
  const company = useQuery({ queryKey: companyKeys.current, queryFn: fetchCompany, enabled: acting });
  const exit = useMutation({
    mutationFn: exitCompany,
    onSuccess: (session) => {
      setSession(session);
      navigate("/empresas", { replace: true });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (!acting) return null;
  const blocked = company.data?.status === "blocked";

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-primary px-4 py-1.5 text-center text-xs font-medium text-white">
      <span className="min-w-0 break-words">
        Você está em: <strong>{company.data?.name ?? "…"}</strong>
        {blocked && " (bloqueada — somente leitura)"}
      </span>
      <button
        type="button"
        className="shrink-0 rounded bg-white/15 px-2 py-0.5 hover:bg-white/25 disabled:opacity-60"
        disabled={exit.isPending}
        onClick={() => exit.mutate()}
      >
        Sair da empresa
      </button>
    </div>
  );
}
