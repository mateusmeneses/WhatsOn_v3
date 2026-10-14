import bcrypt from "bcryptjs";
import { Profile, User } from "../../models";
import { AppError, notFound } from "../../shared/errors/AppError";
import { AuthContext } from "../auth/auth.types";
import { PublicUser, toPublicUser } from "../auth/auth.service";
import { assertQueuesBelong } from "../queues/queues.service";
import { setUserQueues, userQueueIds } from "./userQueues";

export interface UserInput {
  name: string;
  email: string;
  password: string;
  profile: Profile;
  queueIds?: number[];
}

export interface UserView extends PublicUser {
  queueIds: number[];
}

async function view(user: User): Promise<UserView> {
  return { ...toPublicUser(user), queueIds: await userQueueIds(user.id) };
}

export async function getUserOr404(companyId: number, id: number): Promise<User> {
  const user = await User.findOne({ where: { id, companyId } });
  if (!user) throw notFound("Usuário");
  return user;
}

async function assertEmailFree(email: string, exceptId?: number): Promise<void> {
  const existing = await User.findOne({ where: { email } });
  if (existing && existing.id !== exceptId) throw new AppError("EMAIL_IN_USE", 409, "E-mail já cadastrado");
}

export async function listUsers(companyId: number): Promise<UserView[]> {
  const users = await User.findAll({ where: { companyId }, order: [["name", "ASC"]] });
  return Promise.all(users.map(view));
}

export async function createUser(companyId: number, input: UserInput): Promise<UserView> {
  const email = input.email.trim().toLowerCase();
  await assertEmailFree(email);
  await assertQueuesBelong(companyId, input.queueIds ?? []);
  const user = await User.create({
    companyId,
    name: input.name,
    email,
    profile: input.profile,
    passwordHash: await bcrypt.hash(input.password, 10),
  });
  await setUserQueues(user.id, input.queueIds ?? []);
  return view(user);
}

export async function updateUser(companyId: number, id: number, input: Partial<UserInput>): Promise<UserView> {
  const user = await getUserOr404(companyId, id);
  const patch: Partial<Pick<User, "name" | "email" | "profile" | "passwordHash" | "tokenVersion">> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.profile !== undefined) patch.profile = input.profile;
  if (input.email !== undefined) {
    patch.email = input.email.trim().toLowerCase();
    await assertEmailFree(patch.email, user.id);
  }
  if (input.password !== undefined) {
    patch.passwordHash = await bcrypt.hash(input.password, 10);
    patch.tokenVersion = user.tokenVersion + 1;
  }
  if (input.queueIds !== undefined) await assertQueuesBelong(companyId, input.queueIds);
  await user.update(patch);
  if (input.queueIds !== undefined) await setUserQueues(user.id, input.queueIds);
  return view(user);
}

export async function deleteUser(auth: AuthContext, id: number): Promise<void> {
  if (id === auth.userId) throw new AppError("CANNOT_DELETE_SELF", 400, "Você não pode excluir a si mesmo");
  const user = await getUserOr404(auth.companyId, id);
  await user.destroy();
}
