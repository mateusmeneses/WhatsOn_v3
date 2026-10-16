import { Profile } from "../../models";

export interface AuthContext {
  userId: number;
  companyId: number;
  profile: Profile;
  /** Só presente (true) enquanto a senha temporária não foi trocada. */
  mustChangePassword?: boolean;
}
