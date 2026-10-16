import { NextFunction, Request, RequestHandler, Response } from "express";
import { Profile } from "../../models";
import { AppError } from "../../shared/errors/AppError";
import { companyBlocked, isCompanyBlocked } from "../companies/companyStatus";
import { AuthContext, SessionContext } from "./auth.types";
import { verifyAccessToken } from "./tokens";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function authenticate(req: Request): Promise<SessionContext> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new AppError("UNAUTHENTICATED", 401, "Token ausente");
  let session: SessionContext;
  try {
    session = verifyAccessToken(header.slice("Bearer ".length));
  } catch {
    throw new AppError("UNAUTHENTICATED", 401, "Token inválido ou expirado");
  }
  // Com senha temporária só as rotas de /auth (me, logout, change-password) ficam liberadas.
  if (session.mustChangePassword && !req.originalUrl.startsWith("/api/auth/")) {
    throw new AppError("PASSWORD_CHANGE_REQUIRED", 403, "Troque sua senha temporária para continuar");
  }
  // Empresa bloqueada: os usuários dela caem na hora; o super-admin só pode consultar.
  if (session.companyId !== null && (!session.superAdmin || !READ_METHODS.has(req.method))) {
    if (await isCompanyBlocked(session.companyId)) throw companyBlocked();
  }
  req.authSession = session;
  return session;
}

/** Qualquer sessão válida, inclusive a do super-admin fora de uma empresa. */
export async function isSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  await authenticate(req);
  next();
}

/** Sessão dentro de uma empresa (rotas do painel). */
export async function isAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const session = await authenticate(req);
  if (session.companyId === null) throw new AppError("COMPANY_REQUIRED", 403, "Selecione uma empresa");
  req.auth = session as AuthContext;
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

export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.authSession?.superAdmin) throw new AppError("FORBIDDEN", 403, "Sem permissão para esta ação");
  next();
}

export function currentAuth(req: Request): AuthContext {
  if (!req.auth) throw new AppError("UNAUTHENTICATED", 401, "Token ausente");
  return req.auth;
}

export function currentSession(req: Request): SessionContext {
  if (!req.authSession) throw new AppError("UNAUTHENTICATED", 401, "Token ausente");
  return req.authSession;
}
