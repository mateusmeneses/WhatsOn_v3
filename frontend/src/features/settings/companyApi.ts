import { api } from "@/lib/api";
import type { Company } from "@/types/api";

export const companyKeys = { current: ["company"] as const };

export const TIMEZONES: { value: string; label: string }[] = [
  { value: "America/Sao_Paulo", label: "Brasília (São Paulo, Rio, Sul, MG, GO, DF)" },
  { value: "America/Bahia", label: "Bahia" },
  { value: "America/Fortaleza", label: "Fortaleza (CE, RN, PB, PI, MA)" },
  { value: "America/Recife", label: "Recife (PE)" },
  { value: "America/Maceio", label: "Maceió (AL, SE)" },
  { value: "America/Belem", label: "Belém (PA, AP)" },
  { value: "America/Araguaina", label: "Araguaína (TO)" },
  { value: "America/Cuiaba", label: "Cuiabá (MT)" },
  { value: "America/Campo_Grande", label: "Campo Grande (MS)" },
  { value: "America/Manaus", label: "Manaus (AM)" },
  { value: "America/Porto_Velho", label: "Porto Velho (RO)" },
  { value: "America/Boa_Vista", label: "Boa Vista (RR)" },
  { value: "America/Rio_Branco", label: "Rio Branco (AC)" },
  { value: "America/Noronha", label: "Fernando de Noronha" },
];

export async function fetchCompany(): Promise<Company> {
  const { data } = await api.get<Company>("/company");
  return data;
}

export async function updateCompany(input: { name?: string; timezone?: string; responseSlaMinutes?: number }): Promise<Company> {
  const { data } = await api.put<Company>("/company", input);
  return data;
}
