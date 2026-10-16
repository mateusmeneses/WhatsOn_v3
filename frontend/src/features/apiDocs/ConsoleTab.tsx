import { useQuery } from "@tanstack/react-query";
import { Eye, EyeOff, Send, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/apiError";
import { fetchApiToken, STATUS_LABEL } from "@/features/connections/connectionsApi";
import { useConnections } from "@/features/connections/useConnections";
import { CodeBlock, MethodBadge } from "./CodeBlock";
import { buildSample } from "./codeSamples";
import { endpointById, ENDPOINTS, examplePayload } from "./endpoints";
import { runRequest, type ConsoleResult } from "./externalApiClient";

const MANUAL = "manual";

function statusTone(status: number): "success" | "warning" | "danger" {
  if (status >= 200 && status < 300) return "success";
  if (status === 429 || status === 0) return "warning";
  return "danger";
}

export function ConsoleTab({
  baseUrl,
  endpointId,
  onEndpointChange,
}: {
  baseUrl: string;
  endpointId: string;
  onEndpointChange: (id: string) => void;
}) {
  const confirm = useConfirm();
  const connections = useConnections();
  const [source, setSource] = useState<string>("");
  const [manualToken, setManualToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const endpoint = endpointById(endpointId);
  const [values, setValues] = useState<Record<string, string>>(() => examplePayload(endpoint));
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<ConsoleResult | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!source && connections.data?.length) setSource(String(connections.data[0].id));
  }, [connections.data, source]);

  useEffect(() => {
    setValues(examplePayload(endpoint));
    setFiles([]);
    setResult(null);
  }, [endpoint]);

  const connectionId = source && source !== MANUAL ? Number(source) : null;
  const tokenQuery = useQuery({
    queryKey: ["connections", connectionId, "api-token"],
    queryFn: () => fetchApiToken(connectionId!),
    enabled: connectionId !== null,
    gcTime: 0,
  });
  const selected = connections.data?.find((c) => c.id === connectionId);
  const token = source === MANUAL ? manualToken.trim() : (tokenQuery.data?.apiToken ?? "");

  const curl = useMemo(() => {
    const payload = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
    return buildSample("curl", endpoint, {
      baseUrl,
      token: token && showToken ? token : "SEU_TOKEN",
      payload,
      withFile: endpoint.body === "multipart" && files.length > 0,
    });
  }, [baseUrl, endpoint, files.length, showToken, token, values]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (
      endpoint.destructive &&
      !(await confirm({
        title: endpoint.title,
        description: "O número será desconectado do WhatsApp e só volta lendo um novo QR code. Continuar?",
        confirmLabel: "Desconectar",
        danger: true,
      }))
    ) {
      return;
    }
    setRunning(true);
    try {
      setResult(await runRequest(endpoint, token, values, files));
    } finally {
      setRunning(false);
    }
  }

  const body = result?.body as { qrcode?: string | null } | undefined;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <form className="space-y-4" onSubmit={onSubmit} aria-label="Console de testes">
          <div>
            <Label htmlFor="console-source">Token</Label>
            <Select id="console-source" value={source} onChange={(e) => setSource(e.target.value)}>
              {connections.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {STATUS_LABEL[c.status]}
                </option>
              ))}
              <option value={MANUAL}>Colar outro token…</option>
            </Select>
          </div>

          {source === MANUAL ? (
            <div>
              <Label htmlFor="console-token">Token de API</Label>
              <Input
                id="console-token"
                type={showToken ? "text" : "password"}
                autoComplete="off"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="Cole o token"
              />
            </div>
          ) : tokenQuery.isLoading || connections.isLoading ? (
            <Spinner />
          ) : tokenQuery.isError ? (
            <p className="text-sm text-danger">{errorMessage(tokenQuery.error)}</p>
          ) : selected && !token ? (
            <p className="rounded-lg border border-border bg-background p-3 text-sm text-ink-muted">
              {selected.name} ainda não tem token.{" "}
              <Link to="/conexoes" className="font-medium text-primary hover:underline">
                Gere em Conexões
              </Link>{" "}
              (botão da chave).
            </p>
          ) : null}

          {token && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
              <code className="min-w-0 flex-1 truncate font-mono text-xs" data-testid="console-token">
                {showToken ? token : "•".repeat(24)}
              </code>
              <button
                type="button"
                aria-label={showToken ? "Ocultar token" : "Mostrar token"}
                className="rounded p-1 text-ink-muted hover:bg-primary-soft"
                onClick={() => setShowToken((v) => !v)}
              >
                {showToken ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
              </button>
            </div>
          )}

          <div>
            <Label htmlFor="console-endpoint">Rota</Label>
            <Select id="console-endpoint" value={endpoint.id} onChange={(e) => onEndpointChange(e.target.value)}>
              {ENDPOINTS.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.method} {e.path} — {e.title}
                </option>
              ))}
            </Select>
            <p className="mt-1.5 flex items-center gap-2 text-xs text-ink-muted">
              <MethodBadge method={endpoint.method} /> {endpoint.summary}
            </p>
          </div>

          {endpoint.fields.map((f) => {
            const id = `console-field-${f.name}`;
            const label = `${f.name}${f.required ? " *" : ""}`;
            if (f.type === "file") {
              return (
                <div key={f.name}>
                  <Label htmlFor={id}>{label}</Label>
                  <input
                    id={id}
                    type="file"
                    multiple
                    className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary"
                    onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                  />
                  <p className="mt-1 text-xs text-ink-muted">{f.description}</p>
                </div>
              );
            }
            const props = {
              id,
              value: values[f.name] ?? "",
              placeholder: f.example,
              onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [f.name]: e.target.value })),
            };
            return (
              <div key={f.name}>
                <Label htmlFor={id}>{label}</Label>
                {f.multiline ? <Textarea rows={3} {...props} /> : <Input {...props} />}
                <p className="mt-1 text-xs text-ink-muted">{f.description}</p>
              </div>
            );
          })}

          {(endpoint.id.startsWith("send") || endpoint.destructive) && (
            <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-warning">
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
              {endpoint.destructive
                ? "Esta chamada desconecta o número de verdade."
                : "Esta chamada envia uma mensagem real pelo WhatsApp e abre/atualiza o atendimento do contato."}
            </p>
          )}

          <Button type="submit" loading={running} disabled={!token}>
            <Send className="h-4 w-4" aria-hidden /> Enviar requisição
          </Button>
        </form>
      </Card>

      <div className="space-y-4">
        <Card className="space-y-3">
          <p className="text-sm font-medium">Resposta</p>
          {result ? (
            <div className="space-y-3" data-testid="console-result">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={statusTone(result.status)}>HTTP {result.status || "—"}</Badge>
                <span className="text-ink-muted">{result.durationMs} ms</span>
                {Object.entries(result.headers)
                  .filter(([k]) => k !== "content-type")
                  .map(([k, v]) => (
                    <span key={k} className="font-mono text-ink-muted">
                      {k}: {v}
                    </span>
                  ))}
              </div>
              {body?.qrcode && (
                <img src={body.qrcode} alt="QR code retornado" className="h-56 w-56 rounded-lg border border-border" />
              )}
              <CodeBlock code={JSON.stringify(result.body, null, 2)} label="Copiar resposta" />
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Envie uma requisição para ver o status, o tempo e o JSON de resposta.</p>
          )}
        </Card>
        <Card className="space-y-3">
          <p className="text-sm font-medium">cURL equivalente</p>
          <CodeBlock code={curl} label="Copiar cURL" />
          {!showToken && <p className="text-xs text-ink-muted">O token fica oculto aqui até você clicar em mostrar.</p>}
        </Card>
      </div>
    </div>
  );
}
