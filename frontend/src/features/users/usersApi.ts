import { api } from "@/lib/api";
import type { Profile, UserOption, UserView } from "@/types/api";

export const userKeys = {
  all: ["users"] as const,
  options: ["users", "options"] as const,
};

export interface UserInput {
  name: string;
  email: string;
  password?: string;
  profile: Profile;
  queueIds: number[];
}

export const PROFILE_LABEL: Record<Profile, string> = {
  admin: "Administrador",
  supervisor: "Supervisor",
  agent: "Atendente",
};

export async function fetchUserOptions(): Promise<UserOption[]> {
  const { data } = await api.get<UserOption[]>("/users/options");
  return data;
}

export async function fetchUsers(): Promise<UserView[]> {
  const { data } = await api.get<UserView[]>("/users");
  return data;
}

export async function createUser(input: UserInput): Promise<UserView> {
  const { data } = await api.post<UserView>("/users", input);
  return data;
}

export async function updateUser(id: number, input: UserInput): Promise<UserView> {
  const { data } = await api.put<UserView>(`/users/${id}`, input);
  return data;
}

export async function deleteUser(id: number): Promise<void> {
  await api.delete(`/users/${id}`);
}
