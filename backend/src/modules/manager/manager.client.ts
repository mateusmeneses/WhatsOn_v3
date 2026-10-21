import { env } from "../../config/env";
import { AppError } from "../../shared/errors/AppError";

export interface ManagerConfig {
  url: string;
  token: string;
  companyId: number;
}

/** Integração com o Manager: só liga quando URL, token e empresa estão configurados. */
export function managerConfig(): ManagerConfig | null {
  if (!env.MANAGER_API_URL || !env.MANAGER_API_TOKEN || !env.MANAGER_COMPANY_ID) return null;
  return { url: env.MANAGER_API_URL.replace(/\/+$/, ""), token: env.MANAGER_API_TOKEN, companyId: env.MANAGER_COMPANY_ID };
}

export const isManagerEnabled = (companyId: number): boolean => managerConfig()?.companyId === companyId;

const TIMEOUT_MS = 15_000;
const BASE = "/api/integracao/whatson";

/** Chama a API do Manager. Erros do Manager viram AppError (400/404/409 repassados; o resto vira 502). */
export async function managerRequest<T>(
  method: "GET" | "POST",
  path: string,
  opts: { query?: Record<string, string | undefined>; body?: unknown } = {},
): Promise<T> {
  const cfg = managerConfig();
  if (!cfg) throw new AppError("MANAGER_DISABLED", 404, "Integração com o Manager não está ativa");
  const url = new URL(`${cfg.url}${BASE}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: "application/json",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AppError("MANAGER_UNREACHABLE", 502, "Não foi possível falar com o Manager. Tente novamente.");
  }

  const data = (await res.json().catch(() => null)) as (T & { erro?: string }) | null;
  if (res.ok) return data as T;
  const message = data?.erro ?? `O Manager respondeu com erro (${res.status})`;
  if ([400, 404, 409].includes(res.status)) throw new AppError("MANAGER_REJECTED", res.status, message);
  throw new AppError("MANAGER_ERROR", 502, message);
}
