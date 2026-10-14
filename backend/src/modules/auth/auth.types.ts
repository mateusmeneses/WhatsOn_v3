import { Profile } from "../../models";

export interface AuthContext {
  userId: number;
  companyId: number;
  profile: Profile;
}
