import { UniqueConstraintError } from "sequelize";
import { sequelize } from "../../database/sequelize";
import { Company, Connection, ConnectionStatus, Partner } from "../../models";
import { AppError, notFound } from "../../shared/errors/AppError";
import { companyBlocked } from "../companies/companyStatus";
import { createConnection, generateApiToken, regenerateConnectionApiToken } from "../connections/connections.service";

export interface PartnerCompany {
  company: { id: number; cnpj: string; name: string; status: string; createdAt: Date };
  connection: { id: number; status: ConnectionStatus; number: string | null } | null;
  apiToken: string | null;
}

export interface PartnerCompanyInput {
  /** Já normalizado. */
  cnpj: string;
  name: string;
  tradeName?: string | null;
  email?: string | null;
  phone?: string | null;
}

const CONNECTION_NAME = "WhatsApp";

function present(company: Company, connection: Connection | null): PartnerCompany {
  return {
    company: {
      id: company.id,
      cnpj: company.cnpj!,
      name: company.name,
      status: company.status,
      createdAt: company.get("createdAt") as Date,
    },
    connection: connection ? { id: connection.id, status: connection.status, number: connection.number } : null,
    apiToken: connection?.apiToken ?? null,
  };
}

/** Uma conexão por empresa de parceiro: a padrão; sem padrão, a mais antiga. */
function partnerConnection(companyId: number): Promise<Connection | null> {
  return Connection.findOne({ where: { companyId }, order: [["isDefault", "DESC"], ["id", "ASC"]] });
}

async function ownCompanyOr404(partner: Partner, cnpj: string): Promise<Company> {
  const company = await Company.findOne({ where: { cnpj, partnerId: partner.id } });
  if (!company) throw notFound("Empresa");
  return company;
}

function companyName(input: PartnerCompanyInput): string {
  return (input.tradeName?.trim() || input.name.trim()).slice(0, 80);
}

/**
 * Cria ou obtém a empresa do parceiro pelo CNPJ, com a conexão e o token da API externa.
 * Idempotente: repetir (inclusive em paralelo ou depois de falha na Evolution) completa o que faltou
 * e nunca troca um token existente.
 */
export async function upsertPartnerCompany(
  partner: Partner,
  input: PartnerCompanyInput,
): Promise<{ created: boolean; result: PartnerCompany }> {
  const attrs = {
    name: companyName(input),
    ...(input.email !== undefined ? { contactEmail: input.email } : {}),
    ...(input.phone !== undefined ? { contactPhone: input.phone } : {}),
  };
  let company = await Company.findOne({ where: { cnpj: input.cnpj } });
  let created = false;
  if (!company) {
    try {
      company = await Company.create({ ...attrs, cnpj: input.cnpj, partnerId: partner.id });
      created = true;
    } catch (err) {
      if (!(err instanceof UniqueConstraintError)) throw err;
      company = await Company.findOne({ where: { cnpj: input.cnpj } });
      if (!company) throw err;
    }
  }
  if (company.partnerId !== partner.id) {
    throw new AppError("CNPJ_IN_USE", 409, "CNPJ já cadastrado em outra empresa");
  }
  if (company.status === "blocked") return { created, result: present(company, await partnerConnection(company.id)) };
  if (!created) await company.update(attrs);

  const target = company;
  // Trava a empresa para que chamadas simultâneas não criem duas conexões/instâncias. NO KEY UPDATE (e não UPDATE):
  // o insert da conexão roda em outra conexão do pool e a checagem de FK dele pede KEY SHARE na empresa.
  const connection = await sequelize.transaction(async (transaction) => {
    await Company.findByPk(target.id, { lock: transaction.LOCK.NO_KEY_UPDATE, transaction });
    const existing = await partnerConnection(target.id);
    const conn = existing ?? (await createConnection(target.id, { name: CONNECTION_NAME, isDefault: true }));
    if (!conn.apiToken) await conn.update({ apiToken: generateApiToken() });
    return conn;
  });
  return { created, result: present(company, connection) };
}

export async function getPartnerCompany(partner: Partner, cnpj: string): Promise<PartnerCompany> {
  const company = await ownCompanyOr404(partner, cnpj);
  return present(company, await partnerConnection(company.id));
}

/** Troca o token da conexão; o anterior deixa de valer na hora. */
export async function regeneratePartnerCompanyToken(partner: Partner, cnpj: string): Promise<PartnerCompany> {
  const company = await ownCompanyOr404(partner, cnpj);
  if (company.status === "blocked") throw companyBlocked();
  const connection = await partnerConnection(company.id);
  if (!connection) throw notFound("Conexão");
  await regenerateConnectionApiToken(company.id, connection.id);
  return present(company, await connection.reload());
}
