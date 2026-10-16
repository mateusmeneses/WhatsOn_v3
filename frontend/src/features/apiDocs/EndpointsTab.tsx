import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CodeBlock, InlineCode, MethodBadge } from "./CodeBlock";
import { buildSample } from "./codeSamples";
import { ENDPOINTS, examplePayload } from "./endpoints";

export function EndpointsTab({ baseUrl, onTry }: { baseUrl: string; onTry: (endpointId: string) => void }) {
  return (
    <div className="space-y-4">
      {ENDPOINTS.map((e) => (
        <Card key={e.id}>
          <article aria-labelledby={`ep-${e.id}`} className="space-y-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 id={`ep-${e.id}`} className="flex items-center gap-2 text-base font-semibold">
                  <MethodBadge method={e.method} />
                  <span className="font-mono text-sm">{e.path}</span>
                </h2>
                <p className="font-medium">{e.title}</p>
                <p className="text-ink-muted">{e.summary}</p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => onTry(e.id)} aria-label={`Testar ${e.title}`}>
                <Play className="h-4 w-4" aria-hidden /> Testar
              </Button>
            </div>

            {e.fields.length > 0 && (
              <div className="overflow-x-auto">
                <p className="mb-2 font-medium">
                  Corpo {e.body === "multipart" ? "(JSON ou multipart/form-data)" : "(JSON)"}
                </p>
                <table className="w-full text-left text-xs">
                  <thead className="text-ink-muted">
                    <tr className="border-b border-border">
                      <th className="py-2 pr-3 font-medium">Campo</th>
                      <th className="py-2 pr-3 font-medium">Tipo</th>
                      <th className="py-2 pr-3 font-medium">Obrigatório</th>
                      <th className="py-2 font-medium">Descrição</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.fields.map((f) => (
                      <tr key={f.name} className="border-b border-border/60 align-top">
                        <td className="py-2 pr-3 font-mono">{f.name}</td>
                        <td className="py-2 pr-3">{f.type === "file" ? "arquivo[]" : "texto"}</td>
                        <td className="py-2 pr-3">{f.required ? "sim" : "não"}</td>
                        <td className="py-2">{f.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="grid gap-4 xl:grid-cols-2">
              <div>
                <p className="mb-2 font-medium">Requisição</p>
                <CodeBlock code={buildSample("curl", e, { baseUrl, token: "SEU_TOKEN", payload: examplePayload(e) })} />
              </div>
              <div>
                <p className="mb-2 font-medium">Resposta {e.id.startsWith("send") ? "201" : "200"}</p>
                <CodeBlock code={JSON.stringify(e.response, null, 2)} label="Copiar resposta" />
              </div>
            </div>

            {(e.notes?.length || e.errors.length > 0) && (
              <ul className="list-disc space-y-1 pl-5 text-ink-muted">
                {e.notes?.map((n) => <li key={n}>{n}</li>)}
                <li>
                  Erros específicos:{" "}
                  {e.errors.map((code, i) => (
                    <span key={code}>
                      {i > 0 && ", "}
                      <InlineCode>{code}</InlineCode>
                    </span>
                  ))}
                  .
                </li>
              </ul>
            )}
          </article>
        </Card>
      ))}
    </div>
  );
}
