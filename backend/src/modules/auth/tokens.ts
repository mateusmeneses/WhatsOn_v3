import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { Profile } from "../../models";
import { AuthContext } from "./auth.types";

export function signAccessToken(u: { id: number; companyId: number; profile: Profile; mustChangePassword?: boolean }): string {
  const claims = { companyId: u.companyId, profile: u.profile, typ: "access", ...(u.mustChangePassword ? { pwd: true } : {}) };
  return jwt.sign(claims, env.JWT_SECRET, {
    subject: String(u.id),
    expiresIn: "15m",
  });
}

export function verifyAccessToken(token: string): AuthContext {
  const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  if (payload.typ !== "access" || typeof payload.sub !== "string" || typeof payload.companyId !== "number") {
    throw new Error("invalid access token");
  }
  return {
    userId: Number(payload.sub),
    companyId: payload.companyId,
    profile: payload.profile as Profile,
    ...(payload.pwd === true ? { mustChangePassword: true } : {}),
  };
}

export function signRefreshToken(u: { id: number; tokenVersion: number }): string {
  return jwt.sign({ tv: u.tokenVersion, typ: "refresh" }, env.JWT_REFRESH_SECRET, {
    subject: String(u.id),
    expiresIn: "7d",
  });
}

export function verifyRefreshToken(token: string): { userId: number; tokenVersion: number } {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;
  if (payload.typ !== "refresh" || typeof payload.sub !== "string") throw new Error("invalid refresh token");
  return { userId: Number(payload.sub), tokenVersion: Number(payload.tv) };
}
