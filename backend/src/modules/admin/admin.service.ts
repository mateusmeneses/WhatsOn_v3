import bcrypt from "bcryptjs";
import { fn, col, UniqueConstraintError } from "sequelize";
import { sequelize } from "../../database/sequelize";
import { Company, User } from "../../models";
import { AppError, notFound } from "../../shared/errors/AppError";
import { issueSession, PublicUser, toPublicUser } from "../auth/auth.service";
import { SessionContext } from "../auth/auth.types";
import { disconnectCompany } from "../realtime/socket";
import { generateTemporaryPassword, normalizePhone } from "../users/welcome";

export interface CompanyView {
  id: number;
  name: string;
  status: string;
  timezone: string;
  createdAt: Date;
  userCount: number;
}

export interface CompanyInput {
  name?: string;
  timezone?: string;
}

export interface CreateCompanyInput {
  name: string;
  timezone?: string;
  admin: { name: string; email: string; phone?: string | null };
}

async function userCounts(companyIds?: number[]): Promise<Map<number, number>> {
  const rows = (await User.findAll({
    attributes: ["companyId", [fn("COUNT", col("id")), "count"]],
    where: companyIds ? { companyId: companyIds } : {},
    group: ["companyId"],
    raw: true,
  })) as unknown as { companyId: number | null; count: string }[];
  return new Map(rows.filter((r) => r.companyId !== null).map((r) => [r.companyId!, Number(r.count)]));
}

function view(company: Company, userCount: number): CompanyView {
  return {
    id: company.id,
    name: company.name,
    status: company.status,
    timezone: company.timezone,
    createdAt: company.get("createdAt") as Date,
    userCount,
  };
}

async function viewOne(company: Company): Promise<CompanyView> {
  return view(company, (await userCounts([company.id])).get(company.id) ?? 0);
}

async function companyOr404(id: number): Promise<Company> {
  const company = await Company.findByPk(id);
  if (!company) throw notFound("Empresa");
  return company;
}

export async function listCompanies(): Promise<CompanyView[]> {
  const companies = await Company.findAll({ order: [["name", "ASC"], ["id", "ASC"]] });
  const counts = await userCounts();
  return companies.map((c) => view(c, counts.get(c.id) ?? 0));
}

/** Cria a empresa e o primeiro admin, com senha temporária (devolvida uma única vez). */
export async function createCompany(
  input: CreateCompanyInput,
): Promise<{ company: CompanyView; admin: PublicUser; temporaryPassword: string }> {
  const email = input.admin.email.trim().toLowerCase();
  const phone = input.admin.phone ? normalizePhone(input.admin.phone) : null;
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);
  try {
    const { company, admin } = await sequelize.transaction(async (transaction) => {
      const company = await Company.create(
        { name: input.name, ...(input.timezone ? { timezone: input.timezone } : {}) },
        { transaction },
      );
      const admin = await User.create(
        { companyId: company.id, name: input.admin.name, email, phone, profile: "admin", passwordHash, mustChangePassword: true },
        { transaction },
      );
      return { company, admin };
    });
    return { company: view(company, 1), admin: toPublicUser(admin), temporaryPassword };
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw new AppError("EMAIL_IN_USE", 409, "E-mail já cadastrado");
    throw err;
  }
}

export async function updateCompany(id: number, input: CompanyInput): Promise<CompanyView> {
  const company = await companyOr404(id);
  await company.update(input);
  return viewOne(company);
}

/** Bloquear derruba na hora as sessões dos usuários da empresa; desbloquear só libera novos logins. */
export async function setCompanyBlocked(id: number, blocked: boolean): Promise<CompanyView> {
  const company = await companyOr404(id);
  await company.update({ status: blocked ? "blocked" : "active" });
  if (blocked) {
    await User.increment("tokenVersion", { where: { companyId: id } });
    await disconnectCompany(id);
  }
  return viewOne(company);
}

export async function enterCompany(session: SessionContext, companyId: number) {
  await companyOr404(companyId);
  const user = await User.findByPk(session.userId);
  if (!user) throw notFound("Usuário");
  return issueSession(user, companyId);
}

export async function exitCompany(session: SessionContext) {
  const user = await User.findByPk(session.userId);
  if (!user) throw notFound("Usuário");
  return issueSession(user);
}
