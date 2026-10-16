import { api } from "@/lib/api";
import type { AdminCompany, AuthResponse, PublicUser } from "@/types/api";

export const adminKeys = { companies: ["admin", "companies"] as const };

export interface CompanyInput {
  name: string;
  timezone: string;
}

export interface CreateCompanyInput extends CompanyInput {
  admin: { name: string; email: string; phone: string | null };
}

export interface CreatedCompany {
  company: AdminCompany;
  admin: PublicUser;
  /** Senha temporária do primeiro admin, mostrada uma única vez. */
  temporaryPassword: string;
}

export async function fetchCompanies(): Promise<AdminCompany[]> {
  const { data } = await api.get<AdminCompany[]>("/admin/companies");
  return data;
}

export async function createCompany(input: CreateCompanyInput): Promise<CreatedCompany> {
  const { data } = await api.post<CreatedCompany>("/admin/companies", input);
  return data;
}

export async function updateCompany(id: number, input: CompanyInput): Promise<AdminCompany> {
  const { data } = await api.put<AdminCompany>(`/admin/companies/${id}`, input);
  return data;
}

export async function setCompanyBlocked(id: number, blocked: boolean): Promise<AdminCompany> {
  const { data } = await api.post<AdminCompany>(`/admin/companies/${id}/${blocked ? "block" : "unblock"}`);
  return data;
}

export async function enterCompany(id: number): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>(`/admin/companies/${id}/enter`);
  return data;
}

export async function exitCompany(): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>("/admin/exit");
  return data;
}
