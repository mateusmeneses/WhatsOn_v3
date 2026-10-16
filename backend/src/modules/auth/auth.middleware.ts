import { NextFunction, Request, RequestHandler, Response } from "express";
import { Profile } from "../../models";
import { AppError } from "../../shared/errors/AppError";
import { AuthContext } from "./auth.types";
import { verifyAccessToken } from "./tokens";

export function isAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new AppError("UNAUTHENTICATED", 401, "Token ausente");
  try {
    req.auth = verifyAccessToken(header.slice("Bearer ".length));
  } catch {
    throw new AppError("UNAUTHENTICATED", 401, "Token inválido ou expirado");
  }
  // Com senha temporária só as rotas de /auth (me, logout, change-password) ficam liberadas.
  if (req.auth.mustChangePassword && !req.originalUrl.startsWith("/api/auth/")) {
    throw new AppError("PASSWORD_CHANGE_REQUIRED", 403, "Troque sua senha temporária para continuar");
  }
  next();
}

export function requireProfile(...profiles: Profile[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth || !profiles.includes(req.auth.profile)) {
      throw new AppError("FORBIDDEN", 403, "Sem permissão para esta ação");
    }
    next();
  };
}

export function currentAuth(req: Request): AuthContext {
  if (!req.auth) throw new AppError("UNAUTHENTICATED", 401, "Token ausente");
  return req.auth;
}
