import { api } from "@/lib/api";
import type { AccessDelivery, CompanyProfile, TicketAccess, UserOption, UserView } from "@/types/api";

export const userKeys = {
  all: ["users"] as const,
  options: ["users", "options"] as const,
};

export interface UserInput extends Partial<TicketAccess> {
  name: string;
  email: string;
  password?: string;
  phone?: string | null;
  profile: CompanyProfile;
  queueIds: number[];
  /** Só na criação: envia o acesso por WhatsApp na hora. */
  sendAccess?: boolean;
}

export const PROFILE_LABEL: Record<CompanyProfile, string> = {
  admin: "Administrador",
  supervisor: "Supervisor",
  agent: "Atendente",
};

export const TICKET_ACCESS_LABEL: Record<keyof TicketAccess, string> = {
  canViewBot: "Ver atendimentos no bot (sem setor)",
  canViewOtherQueues: "Ver aguardando de outros setores",
  canViewOthersOpen: "Ver atendimentos de outros atendentes",
};

export async function fetchUserOptions(): Promise<UserOption[]> {
  const { data } = await api.get<UserOption[]>("/users/options");
  return data;
}

export async function fetchUsers(): Promise<UserView[]> {
  const { data } = await api.get<UserView[]>("/users");
  return data;
}

export type UserWithAccess = UserView & { access: AccessDelivery };

export async function createUser(input: UserInput): Promise<UserWithAccess> {
  const { data } = await api.post<UserWithAccess>("/users", input);
  return data;
}

export async function resetUserAccess(id: number): Promise<UserWithAccess> {
  const { data } = await api.post<UserWithAccess>(`/users/${id}/reset-access`);
  return data;
}

export async function updateUser(id: number, input: UserInput): Promise<UserView> {
  const { data } = await api.put<UserView>(`/users/${id}`, input);
  return data;
}

export async function deleteUser(id: number): Promise<void> {
  await api.delete(`/users/${id}`);
}
