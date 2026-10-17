import { api } from "@/lib/api";

export interface AppVersion {
  /** yyyy.MM.dd.N, gravada pelo deploy a partir do version.txt. */
  version: string;
  /** dd/MM/yyyy HH:mm; vazio quando o build não informou. */
  buildTime: string;
}

export interface ChangelogVersion {
  versao: string;
  data: string;
  titulo: string;
  novidades?: string[];
  melhorias?: string[];
  correcoes?: string[];
}

/** Só as últimas versões aparecem em "Novidades" (o arquivo deve manter apenas essas). */
export const MAX_CHANGELOG_VERSIONS = 3;

export async function fetchVersion(): Promise<AppVersion> {
  const { data } = await api.get<AppVersion>("/version");
  return data;
}

/** Conteúdo em public/changelog.json: editar a cada versão, mantendo só as 3 mais recentes. */
export async function fetchChangelog(): Promise<ChangelogVersion[]> {
  const res = await fetch("/changelog.json", { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json()) as { versoes?: ChangelogVersion[] };
  return (data.versoes ?? []).slice(0, MAX_CHANGELOG_VERSIONS);
}
