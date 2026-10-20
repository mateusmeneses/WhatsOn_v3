import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useContext, useEffect, useRef } from "react";
import { RealtimeContext, useRealtimeEvent } from "./RealtimeProvider";

/**
 * Revalida `queryKey` (agrupando rajadas em uma só chamada) quando o socket (re)conecta e quando chegam
 * os eventos informados. A conexão do próprio usuário muda a presença dele, por isso conta como evento.
 */
export function useLiveInvalidate(queryKey: QueryKey, events: string[], delayMs = 4000): void {
  const queryClient = useQueryClient();
  const { epoch } = useContext(RealtimeContext);
  const timer = useRef<number>();
  const keyRef = useRef(queryKey);
  keyRef.current = queryKey;

  const schedule = (delay: number) => {
    if (timer.current !== undefined) return;
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      void queryClient.invalidateQueries({ queryKey: keyRef.current });
    }, delay);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (epoch > 0) schedule(400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);
  for (const event of events) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- a lista de eventos é fixa por chamada
    useRealtimeEvent(event, () => schedule(delayMs));
  }
}
