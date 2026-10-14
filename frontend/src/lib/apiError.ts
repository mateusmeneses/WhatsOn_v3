import axios from "axios";
import type { ApiErrorBody } from "@/types/api";

export function errorCode(err: unknown): string | undefined {
  if (!axios.isAxiosError(err)) return undefined;
  return (err.response?.data as ApiErrorBody | undefined)?.error?.code;
}

export function errorMessage(err: unknown, fallback = "Algo deu errado. Tente novamente."): string {
  if (axios.isAxiosError(err)) {
    const message = (err.response?.data as ApiErrorBody | undefined)?.error?.message;
    if (message) return message;
    if (!err.response) return "Sem conexão com o servidor. Verifique sua internet.";
  }
  return fallback;
}
