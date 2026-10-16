import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLocalMessages } from "@/features/chat/localMessages";
import { useAuth } from "@/stores/auth";
import type { PublicUser } from "@/types/api";

/**
 * Sempre que o usuário da sessão muda (inclusive para nenhum, no logout ou quando a renovação falha)
 * ou o super-admin troca de empresa,
 * descarta todo o cache de dados e as mensagens locais, para nada vazar entre sessões.
 */
export function useSessionReset(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const keyOf = (user: PublicUser | null) => (user ? `${user.id}:${user.companyId ?? "-"}` : null);
    let previousKey = keyOf(useAuth.getState().user);
    return useAuth.subscribe((state) => {
      const key = keyOf(state.user);
      if (key === previousKey) return;
      previousKey = key;
      queryClient.clear();
      useLocalMessages.setState({ byTicket: {} });
    });
  }, [queryClient]);
}
