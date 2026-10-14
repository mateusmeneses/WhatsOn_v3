import { useQuery } from "@tanstack/react-query";
import { fetchQueues, queueKeys } from "./queuesApi";

export function useQueues() {
  return useQuery({ queryKey: queueKeys.all, queryFn: fetchQueues, staleTime: 60_000 });
}
