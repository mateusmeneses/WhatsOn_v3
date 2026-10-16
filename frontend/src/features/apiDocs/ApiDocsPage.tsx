import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs } from "@/components/ui/tabs";
import { CodeTab } from "./CodeTab";
import { ConsoleTab } from "./ConsoleTab";
import { EndpointsTab } from "./EndpointsTab";
import { externalApiBaseUrl } from "./externalApiClient";
import { ManualTab } from "./ManualTab";

type Tab = "manual" | "endpoints" | "console" | "code";

const TABS: { value: Tab; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "endpoints", label: "Rotas" },
  { value: "console", label: "Console de testes" },
  { value: "code", label: "Exemplos de código" },
];

export function ApiDocsPage() {
  const [tab, setTab] = useState<Tab>("manual");
  const [endpointId, setEndpointId] = useState("status");
  const baseUrl = externalApiBaseUrl();

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Integração API"
        description="Manual da API externa para conectar números e enviar mensagens a partir de outros sistemas."
      />
      <div className="mx-auto w-full max-w-6xl space-y-4 p-6">
        <Tabs value={tab} onChange={setTab} items={TABS} className="max-w-2xl" />
        {tab === "manual" && <ManualTab baseUrl={baseUrl} />}
        {tab === "endpoints" && (
          <EndpointsTab
            baseUrl={baseUrl}
            onTry={(id) => {
              setEndpointId(id);
              setTab("console");
            }}
          />
        )}
        {tab === "console" && <ConsoleTab baseUrl={baseUrl} endpointId={endpointId} onEndpointChange={setEndpointId} />}
        {tab === "code" && <CodeTab baseUrl={baseUrl} />}
      </div>
    </div>
  );
}
