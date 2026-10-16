import { Company } from "../../models";
import { AppError } from "../../shared/errors/AppError";

export async function isCompanyBlocked(companyId: number): Promise<boolean> {
  const company = await Company.findByPk(companyId, { attributes: ["status"] });
  return company?.status === "blocked";
}

export function companyBlocked(): AppError {
  return new AppError("COMPANY_BLOCKED", 403, "Empresa bloqueada. Entre em contato com o suporte.");
}
