import axios from "axios";
import { API_URL } from "@/lib/api";
import type { EndpointSpec } from "./endpoints";

/** URL pública da API externa, como os outros sistemas devem chamá-la. */
export function externalApiBaseUrl(): string {
  const origin = API_URL || (typeof window !== "undefined" ? window.location.origin : "");
  return `${origin.replace(/\/$/, "")}/api/v1`;
}

/** Cliente próprio: não leva o JWT do painel nem tenta renovar sessão, como um sistema externo. */
const client = axios.create({ validateStatus: () => true, timeout: 60_000 });

export interface ConsoleResult {
  status: number;
  durationMs: number;
  headers: Record<string, string>;
  body: unknown;
}

const SHOWN_HEADERS = ["content-type", "x-ratelimit-limit", "x-ratelimit-remaining", "retry-after"];

export async function runRequest(
  endpoint: EndpointSpec,
  token: string,
  values: Record<string, string>,
  files: File[] = [],
): Promise<ConsoleResult> {
  const payload = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
  let data: unknown;
  if (endpoint.body === "multipart" && files.length > 0) {
    const form = new FormData();
    for (const [k, v] of Object.entries(payload)) form.append(k, v);
    for (const file of files) form.append("medias", file, file.name);
    data = form;
  } else if (endpoint.body !== "none") {
    data = payload;
  }
  const started = performance.now();
  try {
    const res = await client.request({
      url: `${externalApiBaseUrl()}${endpoint.path}`,
      method: endpoint.method,
      headers: { Authorization: `Bearer ${token}` },
      data,
    });
    const headers: Record<string, string> = {};
    for (const name of SHOWN_HEADERS) {
      const value = res.headers[name];
      if (value !== undefined && value !== null) headers[name] = String(value);
    }
    return { status: res.status, durationMs: Math.round(performance.now() - started), headers, body: res.data };
  } catch (err) {
    return {
      status: 0,
      durationMs: Math.round(performance.now() - started),
      headers: {},
      body: { error: { code: "NETWORK_ERROR", message: err instanceof Error ? err.message : "Falha de rede" } },
    };
  }
}
