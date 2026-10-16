import { NextFunction, Request, Response } from "express";
import { Connection } from "../../models";
import { AppError } from "../../shared/errors/AppError";

/** Autentica pelo token de API da conexão (Authorization: Bearer <apiToken>). */
export async function apiTokenAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) throw new AppError("UNAUTHENTICATED", 401, "Token ausente");
  const connection = await Connection.findOne({ where: { apiToken: token } });
  if (!connection) throw new AppError("INVALID_API_TOKEN", 403, "Token de API inválido");
  req.apiConnection = connection;
  next();
}

export function currentConnection(req: Request): Connection {
  if (!req.apiConnection) throw new AppError("UNAUTHENTICATED", 401, "Token ausente");
  return req.apiConnection;
}
