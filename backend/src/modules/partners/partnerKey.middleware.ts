import { NextFunction, Request, Response } from "express";
import { Partner } from "../../models";
import { AppError } from "../../shared/errors/AppError";
import { hashPartnerKey } from "./partnerKey";

const LAST_USED_RESOLUTION_MS = 60_000;

/** Autentica o sistema parceiro pela chave (Authorization: Bearer <chave>). */
export async function partnerKeyAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const key = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!key) throw new AppError("UNAUTHENTICATED", 401, "Chave de parceiro ausente");
  const partner = await Partner.findOne({ where: { keyHash: hashPartnerKey(key) } });
  if (!partner || partner.status !== "active") {
    throw new AppError("INVALID_PARTNER_KEY", 403, "Chave de parceiro inválida ou revogada");
  }
  // No máximo uma escrita por minuto, para não gravar a cada requisição.
  if (!partner.lastUsedAt || Date.now() - partner.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    await partner.update({ lastUsedAt: new Date() });
  }
  req.partner = partner;
  next();
}

export function currentPartner(req: Request): Partner {
  if (!req.partner) throw new AppError("UNAUTHENTICATED", 401, "Chave de parceiro ausente");
  return req.partner;
}
