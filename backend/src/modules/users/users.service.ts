import bcrypt from "bcryptjs";
import { UniqueConstraintError } from "sequelize";
import { sequelize } from "../../database/sequelize";
import { Profile, User, UserQueue } from "../../models";
import { AppError, notFound } from "../../shared/errors/AppError";
import { AuthContext } from "../auth/auth.types";
import { PublicUser, toPublicUser } from "../auth/auth.service";
import { assertQueuesBelong } from "../queues/queues.service";
import { setUserQueues, userQueueIds } from "./userQueues";
import { generateTemporaryPassword, normalizePhone, sendAccessMessage } from "./welcome";

export interface UserInput {
  name: string;
  email: string;
  /** Sem senha o sistema gera uma temporária. */
  password?: string;
  phone?: string | null;
  profile: Profile;
  queueIds?: number[];
}

export interface UserView extends PublicUser {
  queueIds: number[];
}

/** Resultado do envio do acesso. A senha só volta quando foi gerada e não chegou por WhatsApp. */
export interface AccessDelivery {
  sent: boolean;
  temporaryPassword?: string;
}

const phoneOrNull = (phone: string | null | undefined) => (phone ? normalizePhone(phone) : null);

async function deliverAccess(user: User, password: string, generated: boolean): Promise<AccessDelivery> {
  const sent = await sendAccessMessage(user, password);
  return sent || !generated ? { sent } : { sent, temporaryPassword: password };
}

async function view(user: User): Promise<UserView> {
  return { ...toPublicUser(user), queueIds: await userQueueIds(user.id) };
}

export async function getUserOr404(companyId: number, id: number): Promise<User> {
  const user = await User.findOne({ where: { id, companyId } });
  if (!user) throw notFound("Usuário");
  return user;
}

const emailInUse = () => new AppError("EMAIL_IN_USE", 409, "E-mail já cadastrado");
const lastAdmin = () => new AppError("LAST_ADMIN", 409, "A empresa precisa de pelo menos um administrador");

async function assertNotLastAdmin(user: User): Promise<void> {
  if (user.profile !== "admin") return;
  const admins = await User.count({ where: { companyId: user.companyId, profile: "admin" } });
  if (admins <= 1) throw lastAdmin();
}

async function assertEmailFree(email: string, exceptId?: number): Promise<void> {
  const existing = await User.findOne({ where: { email } });
  if (existing && existing.id !== exceptId) throw emailInUse();
}

export async function listUsers(companyId: number): Promise<UserView[]> {
  const users = await User.findAll({ where: { companyId }, order: [["name", "ASC"]] });
  return Promise.all(users.map(view));
}

export interface UserOption {
  id: number;
  name: string;
  queueIds: number[];
}

/** Lista enxuta (sem e-mail/perfil) para seletores de transferência, disponível a todos os perfis. */
export async function listUserOptions(companyId: number): Promise<UserOption[]> {
  const users = await User.findAll({ where: { companyId }, attributes: ["id", "name"], order: [["name", "ASC"]] });
  const links = users.length
    ? await UserQueue.findAll({ where: { userId: users.map((u) => u.id) }, order: [["queueId", "ASC"]] })
    : [];
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    queueIds: links.filter((l) => l.userId === u.id).map((l) => l.queueId),
  }));
}

export async function createUser(
  companyId: number,
  input: UserInput,
): Promise<UserView & { access: AccessDelivery }> {
  const email = input.email.trim().toLowerCase();
  const phone = phoneOrNull(input.phone);
  await assertEmailFree(email);
  await assertQueuesBelong(companyId, input.queueIds ?? []);
  const password = input.password ?? generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const user = await sequelize.transaction(async (t) => {
      const created = await User.create(
        { companyId, name: input.name, email, phone, profile: input.profile, passwordHash, mustChangePassword: true },
        { transaction: t },
      );
      await setUserQueues(created.id, input.queueIds ?? [], t);
      return created;
    });
    return { ...(await view(user)), access: await deliverAccess(user, password, input.password === undefined) };
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw emailInUse();
    throw err;
  }
}

export async function updateUser(
  companyId: number,
  id: number,
  input: Partial<UserInput>,
  actorId?: number,
): Promise<UserView> {
  const user = await getUserOr404(companyId, id);
  const patch: Partial<
    Pick<User, "name" | "email" | "phone" | "profile" | "passwordHash" | "tokenVersion" | "mustChangePassword">
  > = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.phone !== undefined) patch.phone = phoneOrNull(input.phone);
  if (input.profile !== undefined) patch.profile = input.profile;
  if (input.email !== undefined) {
    patch.email = input.email.trim().toLowerCase();
    await assertEmailFree(patch.email, user.id);
  }
  if (input.password !== undefined) {
    patch.passwordHash = await bcrypt.hash(input.password, 10);
    patch.tokenVersion = user.tokenVersion + 1;
    // Senha definida pelo admin vale como temporária (exceto quando é a própria).
    patch.mustChangePassword = actorId !== user.id;
  }
  if (input.queueIds !== undefined) await assertQueuesBelong(companyId, input.queueIds);
  if (input.profile !== undefined && input.profile !== "admin") await assertNotLastAdmin(user);
  try {
    await sequelize.transaction(async (t) => {
      await user.update(patch, { transaction: t });
      if (input.queueIds !== undefined) await setUserQueues(user.id, input.queueIds, t);
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw emailInUse();
    throw err;
  }
  return view(user);
}

/** Gera nova senha temporária, derruba as sessões e reenvia o acesso por WhatsApp. */
export async function resetAccess(companyId: number, id: number): Promise<UserView & { access: AccessDelivery }> {
  const user = await getUserOr404(companyId, id);
  const password = generateTemporaryPassword();
  await user.update({
    passwordHash: await bcrypt.hash(password, 10),
    mustChangePassword: true,
    tokenVersion: user.tokenVersion + 1,
  });
  return { ...(await view(user)), access: await deliverAccess(user, password, true) };
}

export async function deleteUser(auth: AuthContext, id: number): Promise<void> {
  if (id === auth.userId) throw new AppError("CANNOT_DELETE_SELF", 400, "Você não pode excluir a si mesmo");
  const user = await getUserOr404(auth.companyId, id);
  await assertNotLastAdmin(user);
  await user.destroy();
}
