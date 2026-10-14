import { Profile } from "../../src/models";
import { signAccessToken } from "../../src/modules/auth/tokens";

export function bearer(user: { id: number; companyId: number; profile: Profile }): string {
  return `Bearer ${signAccessToken(user)}`;
}
