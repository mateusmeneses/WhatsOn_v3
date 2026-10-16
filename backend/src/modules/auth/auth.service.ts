import bcrypt from "bcryptjs";
import { Profile, User } from "../../models";
import { AppError, notFound } from "../../shared/errors/AppError";
import { AuthContext } from "./auth.types";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "./tokens";

export interface PublicUser {
  id: number;
  companyId: number;
  name: string;
  email: string;
  profile: Profile;
  phone: string | null;
  mustChangePassword: boolean;
}

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    companyId: u.companyId,
    name: u.name,
    email: u.email,
    profile: u.profile,
    phone: u.phone ?? null,
    mustChangePassword: u.mustChangePassword ?? false,
  };
}

function issueTokens(u: User) {
  return { accessToken: signAccessToken(u), refreshToken: signRefreshToken(u) };
}

export async function login(email: string, password: string) {
  const user = await User.findOne({ where: { email: email.trim().toLowerCase() } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError("INVALID_CREDENTIALS", 401, "E-mail ou senha inválidos");
  }
  return { ...issueTokens(user), user: toPublicUser(user) };
}

export async function refresh(refreshToken: string) {
  const invalid = new AppError("INVALID_REFRESH", 401, "Sessão expirada, faça login novamente");
  let payload: { userId: number; tokenVersion: number };
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw invalid;
  }
  const user = await User.findByPk(payload.userId);
  if (!user || user.tokenVersion !== payload.tokenVersion) throw invalid;
  return { ...issueTokens(user), user: toPublicUser(user) };
}

/** Troca a senha (obrigatório no primeiro acesso); invalida as outras sessões e devolve tokens novos. */
export async function changePassword(auth: AuthContext, currentPassword: string, newPassword: string) {
  const user = await User.findOne({ where: { id: auth.userId, companyId: auth.companyId } });
  if (!user) throw notFound("Usuário");
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
  return { ...issueTokens(user), user: toPublicUser(user) };
}

export async function logout(userId: number): Promise<void> {
  await User.increment("tokenVersion", { where: { id: userId } });
}

export async function me(auth: AuthContext): Promise<PublicUser> {
  const user = await User.findOne({ where: { id: auth.userId, companyId: auth.companyId } });
  if (!user) throw notFound("Usuário");
  return toPublicUser(user);
}
