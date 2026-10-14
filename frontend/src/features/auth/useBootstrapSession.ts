import { useEffect, useState } from "react";
import { refreshAccessToken } from "@/lib/api";
import { refreshTokenStorage, useAuth } from "@/stores/auth";

/** Restaura a sessão a partir do refresh token salvo antes de renderizar as rotas. */
export function useBootstrapSession(): boolean {
  const [ready, setReady] = useState(() => Boolean(useAuth.getState().accessToken) || !refreshTokenStorage.get());
  useEffect(() => {
    if (ready) return;
    void refreshAccessToken().finally(() => setReady(true));
  }, [ready]);
  return ready;
}
