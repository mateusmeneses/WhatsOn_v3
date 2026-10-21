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
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/apiError";
import { companyKeys, fetchCompany, TIMEZONES, updateCompany } from "./companyApi";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const company = useQuery({ queryKey: companyKeys.current, queryFn: fetchCompany });
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [sla, setSla] = useState("5");
  const [inactivity, setInactivity] = useState("0");
  const [inactivityMessage, setInactivityMessage] = useState("");

  useEffect(() => {
    if (company.data) {
      setName(company.data.name);
      setTimezone(company.data.timezone);
      setSla(String(company.data.responseSlaMinutes ?? 5));
      setInactivity(String(company.data.inactivityCloseMinutes ?? 0));
      setInactivityMessage(company.data.inactivityCloseMessage ?? "");
    }
  }, [company.data]);

  const mutation = useMutation({
    mutationFn: () =>
      updateCompany({
        name: name.trim(),
        timezone,
        responseSlaMinutes: Number(sla),
        inactivityCloseMinutes: Number(inactivity),
        inactivityCloseMessage: inactivityMessage,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(companyKeys.current, saved);
      toast.success("Configurações salvas");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const slaNumber = Number(sla);
  const slaValid = Number.isInteger(slaNumber) && slaNumber >= 1 && slaNumber <= 240;
  const inactivityNumber = Number(inactivity);
  const inactivityValid = inactivity !== "" && Number.isInteger(inactivityNumber) && inactivityNumber >= 0 && inactivityNumber <= 10080;
  const zones = TIMEZONES.some((z) => z.value === timezone) ? TIMEZONES : [{ value: timezone, label: timezone }, ...TIMEZONES];

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader title="Configurações" description="Dados gerais da empresa e encerramento por inatividade. As demais mensagens automáticas ficam em Conexões." />
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
              <div>
                <Label htmlFor="company-inactivity">Encerrar por inatividade após (minutos)</Label>
                <Input
                  id="company-inactivity"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={10080}
                  step={1}
                  value={inactivity}
                  onChange={(e) => setInactivity(e.target.value)}
                  className="max-w-[8rem]"
                />
                <p className="mt-1 text-xs text-ink-muted">
                  Finaliza o atendimento quando o cliente fica esse tempo sem responder à última mensagem da equipe. Use 0
                  para desligar (até 10080 minutos, 7 dias).
                </p>
              </div>
              <div>
                <Label htmlFor="company-inactivity-message">Mensagem de encerramento por inatividade</Label>
                <Textarea
                  id="company-inactivity-message"
                  rows={2}
                  maxLength={2000}
                  placeholder="Opcional — vazia usa a mensagem de encerramento da conexão"
                  value={inactivityMessage}
                  onChange={(e) => setInactivityMessage(e.target.value)}
                  disabled={inactivityNumber === 0}
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" loading={mutation.isPending} disabled={!name.trim() || !slaValid || !inactivityValid}>
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
