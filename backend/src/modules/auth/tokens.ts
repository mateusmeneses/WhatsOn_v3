import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { Profile } from "../../models";
import { SessionContext } from "./auth.types";

export function signAccessToken(u: {
  id: number;
  companyId: number | null;
  profile: Profile;
  mustChangePassword?: boolean;
  superAdmin?: boolean;
}): string {
  const claims = {
    ...(u.companyId !== null ? { companyId: u.companyId } : {}),
    profile: u.profile,
    typ: "access",
    ...(u.mustChangePassword ? { pwd: true } : {}),
    ...(u.superAdmin ? { sa: true } : {}),
  };
  return jwt.sign(claims, env.JWT_SECRET, {
    subject: String(u.id),
    expiresIn: "15m",
  });
}

export function verifyAccessToken(token: string): SessionContext {
  const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  const superAdmin = payload.sa === true;
  const companyId = typeof payload.companyId === "number" ? payload.companyId : null;
  if (payload.typ !== "access" || typeof payload.sub !== "string" || (companyId === null && !superAdmin)) {
    throw new Error("invalid access token");
  }
  return {
    userId: Number(payload.sub),
    companyId,
    profile: payload.profile as Profile,
    ...(superAdmin ? { superAdmin: true } : {}),
    ...(payload.pwd === true ? { mustChangePassword: true } : {}),
  };
}

/** `companyId`: empresa em que o super-admin está atuando, para a renovação manter o contexto. */
export function signRefreshToken(u: { id: number; tokenVersion: number }, companyId: number | null = null): string {
  return jwt.sign({ tv: u.tokenVersion, typ: "refresh", ...(companyId !== null ? { cid: companyId } : {}) }, env.JWT_REFRESH_SECRET, {
    subject: String(u.id),
    expiresIn: "7d",
  });
}

export function verifyRefreshToken(token: string): { userId: number; tokenVersion: number; companyId?: number } {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;
  if (payload.typ !== "refresh" || typeof payload.sub !== "string") throw new Error("invalid refresh token");
  return {
    userId: Number(payload.sub),
    tokenVersion: Number(payload.tv),
    ...(typeof payload.cid === "number" ? { companyId: payload.cid } : {}),
  };
}
