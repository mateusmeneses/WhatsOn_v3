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
  /** Incrementa a cada troca de sessão (logout ou outro usuário); renovações em voo de uma geração antiga são descartadas. */
  generation: number;
  setSession(response: AuthResponse): void;
  setAccessToken(token: string): void;
  clear(): void;
}

export const useAuth = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  generation: 0,
  setSession: (response) => {
    refreshTokenStorage.set(response.refreshToken);
    set((s) => ({
      accessToken: response.accessToken,
      user: response.user,
      // Outro usuário ou outra empresa (super-admin): renovações em voo da sessão anterior são descartadas.
      generation:
        s.user && (s.user.id !== response.user.id || s.user.companyId !== response.user.companyId)
          ? s.generation + 1
          : s.generation,
    }));
  },
  setAccessToken: (token) => set({ accessToken: token }),
  clear: () => {
    refreshTokenStorage.clear();
    set((s) => ({ accessToken: null, user: null, generation: s.generation + 1 }));
  },
}));
