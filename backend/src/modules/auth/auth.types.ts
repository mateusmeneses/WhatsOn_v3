import { Profile } from "../../models";

/** Quem está logado. `companyId` é null só para o super-admin fora de uma empresa. */
export interface SessionContext {
  userId: number;
  companyId: number | null;
  /** Perfil efetivo: o super-admin dentro de uma empresa atua como "admin". */
  profile: Profile;
  /** Só presente (true) para o super-admin. */
  superAdmin?: boolean;
  /** Só presente (true) enquanto a senha temporária não foi trocada. */
  mustChangePassword?: boolean;
}

/** Sessão dentro de uma empresa (rotas do painel). */
export interface AuthContext extends SessionContext {
  companyId: number;
}
