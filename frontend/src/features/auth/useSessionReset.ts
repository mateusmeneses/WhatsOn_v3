import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLocalMessages } from "@/features/chat/localMessages";
import { useAuth } from "@/stores/auth";

/**
 * Sempre que o usuário da sessão muda (inclusive para nenhum, no logout ou quando a renovação falha),
 * descarta todo o cache de dados e as mensagens locais, para nada vazar entre sessões.
 */
export function useSessionReset(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    let previousId = useAuth.getState().user?.id ?? null;
    return useAuth.subscribe((state) => {
      const id = state.user?.id ?? null;
      if (id === previousId) return;
      previousId = id;
      queryClient.clear();
      useLocalMessages.setState({ byTicket: {} });
    });
  }, [queryClient]);
}
