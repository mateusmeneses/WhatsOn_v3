import bcrypt from "bcryptjs";
import { Company, Profile, User } from "../../models";
import { AppError, notFound } from "../../shared/errors/AppError";
import { companyBlocked, isCompanyBlocked } from "../companies/companyStatus";
import { SessionContext } from "./auth.types";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "./tokens";

export interface PublicUser {
  id: number;
  /** Empresa da sessão; para o super-admin, a empresa em que está atuando (ou null). */
  companyId: number | null;
  name: string;
  email: string;
  profile: Profile;
  phone: string | null;
  mustChangePassword: boolean;
  superAdmin?: boolean;
}

const isSuperAdmin = (u: User) => u.profile === "superadmin";

/** `actingCompanyId` só vale para o super-admin: dentro de uma empresa ele atua como "admin". */
export function toPublicUser(u: User, actingCompanyId: number | null = null): PublicUser {
  const base = {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone ?? null,
    mustChangePassword: u.mustChangePassword ?? false,
  };
  if (isSuperAdmin(u)) {
    return { ...base, companyId: actingCompanyId, profile: actingCompanyId === null ? "superadmin" : "admin", superAdmin: true };
  }
  return { ...base, companyId: u.companyId, profile: u.profile };
}

/** Tokens + usuário público; para o super-admin, já no contexto da empresa escolhida. */
export function issueSession(u: User, actingCompanyId: number | null = null) {
  const user = toPublicUser(u, actingCompanyId);
  const accessToken = signAccessToken({
    id: u.id,
    companyId: user.companyId,
    profile: user.profile,
    mustChangePassword: user.mustChangePassword,
    superAdmin: user.superAdmin,
  });
  const refreshToken = signRefreshToken(u, isSuperAdmin(u) ? actingCompanyId : null);
  return { accessToken, refreshToken, user };
}

async function assertCompanyActive(u: User, error: AppError): Promise<void> {
  if (u.companyId !== null && !isSuperAdmin(u) && (await isCompanyBlocked(u.companyId))) throw error;
}

export async function login(email: string, password: string) {
  const user = await User.findOne({ where: { email: email.trim().toLowerCase() } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError("INVALID_CREDENTIALS", 401, "E-mail ou senha inválidos");
  }
  await assertCompanyActive(user, companyBlocked());
  await user.update({ lastLoginAt: new Date() });
  return issueSession(user);
}

export async function refresh(refreshToken: string) {
  const invalid = new AppError("INVALID_REFRESH", 401, "Sessão expirada, faça login novamente");
  let payload: { userId: number; tokenVersion: number; companyId?: number };
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw invalid;
  }
  const user = await User.findByPk(payload.userId);
  if (!user || user.tokenVersion !== payload.tokenVersion) throw invalid;
  await assertCompanyActive(user, new AppError("COMPANY_BLOCKED", 401, "Empresa bloqueada. Entre em contato com o suporte."));
  let acting: number | null = null;
  if (isSuperAdmin(user) && payload.companyId !== undefined && (await Company.count({ where: { id: payload.companyId } }))) {
    acting = payload.companyId;
  }
  return issueSession(user, acting);
}

async function sessionUser(session: SessionContext): Promise<User> {
  const user = await User.findByPk(session.userId);
  if (!user) throw notFound("Usuário");
  return user;
}

/** Troca a senha (obrigatório no primeiro acesso); invalida as outras sessões e devolve tokens novos. */
export async function changePassword(session: SessionContext, currentPassword: string, newPassword: string) {
  const user = await sessionUser(session);
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new AppError("INVALID_CURRENT_PASSWORD", 400, "Senha atual incorreta");
  }
  if (currentPassword === newPassword) {
    throw new AppError("SAME_PASSWORD", 400, "A nova senha deve ser diferente da atual");
  }
  await user.update({
    passwordHash: await bcrypt.hash(newPassword, 10),
    mustChangePassword: false,
    tokenVersion: user.tokenVersion + 1,
  });
  return issueSession(user, session.superAdmin ? session.companyId : null);
}

export async function logout(userId: number): Promise<void> {
  await User.increment("tokenVersion", { where: { id: userId } });
}

export async function me(session: SessionContext): Promise<PublicUser> {
  const user = await sessionUser(session);
  return toPublicUser(user, session.superAdmin ? session.companyId : null);
}
