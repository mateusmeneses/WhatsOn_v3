import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { toast } from "sonner";
import { refreshTokenStorage, useAuth } from "@/stores/auth";
import type { ApiErrorBody, AuthResponse } from "@/types/api";

export const API_URL: string = import.meta.env.VITE_API_URL ?? "";

export const api = axios.create({ baseURL: `${API_URL}/api` });

api.interceptors.request.use((config) => {
  const token = useAuth.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const COMPANY_BLOCKED_MESSAGE = "Empresa bloqueada. Entre em contato com o suporte.";

/** Empresa bloqueada: encerra a sessão e avisa (o super-admin nunca cai por isso). */
export function endBlockedSession(): void {
  const user = useAuth.getState().user;
  if (!user || user.superAdmin) return;
  useAuth.getState().clear();
  toast.error(COMPANY_BLOCKED_MESSAGE, { id: "company-blocked" });
}

const isCompanyBlocked = (err: unknown) =>
  axios.isAxiosError(err) && (err.response?.data as ApiErrorBody | undefined)?.error?.code === "COMPANY_BLOCKED";

let refreshing: { generation: number; promise: Promise<string | null> } | null = null;

/**
 * Renova o access token usando o refresh token salvo. Chamadas simultâneas compartilham a mesma renovação.
 * Se a sessão mudar durante a requisição (logout ou outro usuário), o resultado é descartado.
 */
export function refreshAccessToken(): Promise<string | null> {
  const generation = useAuth.getState().generation;
  if (refreshing && refreshing.generation === generation) return refreshing.promise;
  const current: { generation: number; promise: Promise<string | null> } = {
    generation,
    promise: (async () => {
      const refreshToken = refreshTokenStorage.get();
      if (!refreshToken) {
        useAuth.getState().clear();
        return null;
      }
      const stale = () => useAuth.getState().generation !== generation;
      try {
        const { data } = await axios.post<AuthResponse>(`${API_URL}/api/auth/refresh`, { refreshToken });
        if (stale()) return null;
        useAuth.getState().setSession(data);
        return data.accessToken;
      } catch (err) {
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        if (isCompanyBlocked(err) && !stale()) endBlockedSession();
        else if ((status === 401 || status === 403) && !stale()) useAuth.getState().clear();
        return null;
      }
    })().finally(() => {
      if (refreshing === current) refreshing = null;
    }),
  };
  refreshing = current;
  return current.promise;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const isAuthCall = original?.url === "/auth/login" || original?.url === "/auth/refresh";
    if (error.response?.status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true;
      const token = await refreshAccessToken();
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
    }
    if (error.response?.status === 403 && isCompanyBlocked(error) && !isAuthCall) endBlockedSession();
    return Promise.reject(error);
  },
);
