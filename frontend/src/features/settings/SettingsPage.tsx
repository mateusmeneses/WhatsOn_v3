import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/apiError";
import { companyKeys, fetchCompany, TIMEZONES, updateCompany } from "./companyApi";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const company = useQuery({ queryKey: companyKeys.current, queryFn: fetchCompany });
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [sla, setSla] = useState("5");

  useEffect(() => {
    if (company.data) {
      setName(company.data.name);
      setTimezone(company.data.timezone);
      setSla(String(company.data.responseSlaMinutes ?? 5));
    }
  }, [company.data]);

  const mutation = useMutation({
    mutationFn: () => updateCompany({ name: name.trim(), timezone, responseSlaMinutes: Number(sla) }),
    onSuccess: (saved) => {
      queryClient.setQueryData(companyKeys.current, saved);
      toast.success("Configurações salvas");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const slaNumber = Number(sla);
  const slaValid = Number.isInteger(slaNumber) && slaNumber >= 1 && slaNumber <= 240;
  const zones = TIMEZONES.some((z) => z.value === timezone) ? TIMEZONES : [{ value: timezone, label: timezone }, ...TIMEZONES];

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader title="Configurações" description="Dados gerais da empresa. As mensagens automáticas ficam em Conexões." />
      <div className="max-w-xl p-6">
        <Card>
          {company.isLoading ? (
            <Spinner />
          ) : company.isError ? (
            <p className="text-sm text-danger">{errorMessage(company.error)}</p>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                mutation.mutate();
              }}
            >
              <div>
                <Label htmlFor="company-name">Nome da empresa</Label>
                <Input id="company-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="company-tz">Fuso horário</Label>
                <Select id="company-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  {zones.map((z) => (
                    <option key={z.value} value={z.value}>
                      {z.label}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-ink-muted">Usado para calcular o horário de expediente das filas.</p>
              </div>
              <div>
                <Label htmlFor="company-sla">Meta de primeira resposta (minutos)</Label>
                <Input
                  id="company-sla"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={240}
                  step={1}
                  value={sla}
                  onChange={(e) => setSla(e.target.value)}
                  className="max-w-[8rem]"
                />
                <p className="mt-1 text-xs text-ink-muted">
                  O Dashboard mostra a porcentagem de clientes respondidos dentro dessa meta (de 1 a 240 minutos).
                </p>
              </div>
              <div className="flex justify-end">
                <Button type="submit" loading={mutation.isPending} disabled={!name.trim() || !slaValid}>
                  Salvar
                </Button>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
