import { create } from "zustand";
import type { AuthResponse, PublicUser } from "@/types/api";

const REFRESH_KEY = "whatson.refreshToken";

export const refreshTokenStorage = {
  get(): string | null {
    try {
      return localStorage.getItem(REFRESH_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      localStorage.setItem(REFRESH_KEY, token);
    } catch {
      // armazenamento indisponível: a sessão dura até fechar a aba
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(REFRESH_KEY);
    } catch {
      // ignorado
    }
  },
};

interface AuthState {
  accessToken: string | null;
  user: PublicUser | null;
  setSession(response: AuthResponse): void;
  setAccessToken(token: string): void;
  clear(): void;
}

export const useAuth = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setSession: (response) => {
    refreshTokenStorage.set(response.refreshToken);
    set({ accessToken: response.accessToken, user: response.user });
  },
  setAccessToken: (token) => set({ accessToken: token }),
  clear: () => {
    refreshTokenStorage.clear();
    set({ accessToken: null, user: null });
  },
}));
