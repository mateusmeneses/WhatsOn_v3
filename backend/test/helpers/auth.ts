import { Profile } from "../../src/models";
import { signAccessToken } from "../../src/modules/auth/tokens";

export function bearer(user: { id: number; companyId: number | null; profile: Profile }): string {
  return `Bearer ${signAccessToken(user)}`;
}

/** Super-admin fora de empresa ou, com `companyId`, atuando como admin dela. */
export function superAdminBearer(user: { id: number }, companyId: number | null = null): string {
  return `Bearer ${signAccessToken({ id: user.id, companyId, profile: companyId === null ? "superadmin" : "admin", superAdmin: true })}`;
}
