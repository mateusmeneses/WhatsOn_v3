import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { refreshTokenStorage, useAuth } from "@/stores/auth";
import type { AuthResponse } from "@/types/api";

export const API_URL: string = import.meta.env.VITE_API_URL ?? "";

export const api = axios.create({ baseURL: `${API_URL}/api` });

api.interceptors.request.use((config) => {
  const token = useAuth.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

/** Renova o access token usando o refresh token salvo. Chamadas simultâneas compartilham a mesma renovação. */
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = (async () => {
      const refreshToken = refreshTokenStorage.get();
      if (!refreshToken) return null;
      try {
        const { data } = await axios.post<AuthResponse>(`${API_URL}/api/auth/refresh`, { refreshToken });
        useAuth.getState().setSession(data);
        return data.accessToken;
      } catch {
        useAuth.getState().clear();
        return null;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const isAuthCall = original?.url?.startsWith("/auth/") ?? false;
    if (error.response?.status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true;
      const token = await refreshAccessToken();
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);
