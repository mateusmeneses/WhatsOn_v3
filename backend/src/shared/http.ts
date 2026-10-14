import { Request } from "express";
import { AppError } from "./errors/AppError";

export const PAGE_SIZE = 30;

export function idParam(req: Request, name = "id"): number {
  const value = Number(req.params[name]);
  if (!Number.isInteger(value) || value <= 0) throw new AppError("INVALID_ID", 400, "Id inválido");
  return value;
}

export function pageParam(value: unknown): number {
  const page = Number(value ?? 1);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** Recebe até PAGE_SIZE + 1 linhas e devolve a página + se há mais. */
export function paginate<T>(rows: T[], size = PAGE_SIZE): { items: T[]; hasMore: boolean } {
  return { items: rows.slice(0, size), hasMore: rows.length > size };
}
