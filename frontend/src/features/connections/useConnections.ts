import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRealtimeEvent } from "@/realtime/RealtimeProvider";
import type { Connection } from "@/types/api";
import { connectionKeys, fetchConnections } from "./connectionsApi";

export function useConnections() {
  return useQuery({ queryKey: connectionKeys.all, queryFn: fetchConnections });
}

export function useConnectionRealtime(): void {
  const queryClient = useQueryClient();
  useRealtimeEvent<Connection>("connection:update", (updated) => {
    queryClient.setQueryData<Connection[]>(connectionKeys.all, (list) =>
      list?.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
    );
  });
}
