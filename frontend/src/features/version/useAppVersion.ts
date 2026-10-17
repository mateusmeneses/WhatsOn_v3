import { useQuery } from "@tanstack/react-query";
import { fetchVersion } from "./versionApi";

/** Versão do build no ar (GET /api/version); some silenciosamente se a API não responder. */
export function useAppVersion() {
  return useQuery({ queryKey: ["app-version"], queryFn: fetchVersion, staleTime: Infinity, retry: false });
}
