import { api } from "@/lib/api";
import type { UserOption } from "@/types/api";

export const userKeys = {
  all: ["users"] as const,
  options: ["users", "options"] as const,
};

export async function fetchUserOptions(): Promise<UserOption[]> {
  const { data } = await api.get<UserOption[]>("/users/options");
  return data;
}
