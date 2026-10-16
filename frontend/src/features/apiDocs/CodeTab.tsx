import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { CodeBlock } from "./CodeBlock";
import { buildSample, LANGUAGES, type Language } from "./codeSamples";
import { endpointById, ENDPOINTS, examplePayload } from "./endpoints";

export function CodeTab({ baseUrl }: { baseUrl: string }) {
  const [language, setLanguage] = useState<Language>("curl");
  const [endpointId, setEndpointId] = useState("send");
  const [withFile, setWithFile] = useState(false);
  const endpoint = endpointById(endpointId);
  const canAttach = endpoint.body === "multipart";
  const code = buildSample(language, endpoint, {
    baseUrl,
    token: "SEU_TOKEN",
    payload: examplePayload(endpoint),
    withFile: canAttach && withFile,
  });

  return (
    <Card className="space-y-4">
      <p className="text-sm text-ink-muted">
        Exemplos prontos para copiar. Troque <strong>SEU_TOKEN</strong> pelo token da conexão e mantenha-o no servidor do seu
        sistema.
      </p>
      <Tabs value={language} onChange={setLanguage} items={LANGUAGES} />
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-64">
          <Label htmlFor="code-endpoint">Rota</Label>
          <Select id="code-endpoint" value={endpointId} onChange={(e) => setEndpointId(e.target.value)}>
            {ENDPOINTS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.method} {e.path} — {e.title}
              </option>
            ))}
          </Select>
        </div>
        {canAttach && (
          <label className="flex h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={withFile} onChange={(e) => setWithFile(e.target.checked)} />
            Com arquivo (multipart)
          </label>
        )}
      </div>
      <CodeBlock code={code} />
    </Card>
  );
}
