import { api } from "@/lib/api";
import type { AdminCompany, AdminPartner, AuthResponse, PublicUser } from "@/types/api";

export const adminKeys = { companies: ["admin", "companies"] as const, partners: ["admin", "partners"] as const };

export interface CompanyInput {
  name: string;
  timezone: string;
  /** Na edição, vazio limpa; na criação, só vai quando informado. */
  cnpj?: string | null;
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

/** Parceiro com a chave completa, devolvida só ao criar ou regenerar. */
export interface PartnerWithKey {
  partner: AdminPartner;
  key: string;
}

export async function fetchPartners(): Promise<AdminPartner[]> {
  const { data } = await api.get<AdminPartner[]>("/admin/partners");
  return data;
}

export async function createPartner(name: string): Promise<PartnerWithKey> {
  const { data } = await api.post<PartnerWithKey>("/admin/partners", { name });
  return data;
}

export async function updatePartner(id: number, name: string): Promise<AdminPartner> {
  const { data } = await api.put<AdminPartner>(`/admin/partners/${id}`, { name });
  return data;
}

export async function regeneratePartnerKey(id: number): Promise<PartnerWithKey> {
  const { data } = await api.post<PartnerWithKey>(`/admin/partners/${id}/regenerate-key`);
  return data;
}

export async function setPartnerRevoked(id: number, revoked: boolean): Promise<AdminPartner> {
  const { data } = await api.post<AdminPartner>(`/admin/partners/${id}/${revoked ? "revoke" : "activate"}`);
  return data;
}
