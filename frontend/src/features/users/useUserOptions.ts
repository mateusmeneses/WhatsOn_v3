import { useQuery } from "@tanstack/react-query";
import { fetchUserOptions, userKeys } from "./usersApi";

export function useUserOptions() {
  return useQuery({ queryKey: userKeys.options, queryFn: fetchUserOptions, staleTime: 60_000 });
}
