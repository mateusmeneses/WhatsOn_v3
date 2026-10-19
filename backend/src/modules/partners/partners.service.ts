import { col, fn } from "sequelize";
import { Company, Partner, PartnerStatus } from "../../models";
import { notFound } from "../../shared/errors/AppError";
import { generatePartnerKey } from "./partnerKey";

export interface PartnerView {
  id: number;
  name: string;
  keyPrefix: string;
  status: PartnerStatus;
  lastUsedAt: Date | null;
  createdAt: Date;
  companyCount: number;
}

async function companyCounts(partnerIds: number[]): Promise<Map<number, number>> {
  if (partnerIds.length === 0) return new Map();
  const rows = (await Company.findAll({
    attributes: ["partnerId", [fn("COUNT", col("id")), "count"]],
    where: { partnerId: partnerIds },
    group: ["partnerId"],
    raw: true,
  })) as unknown as { partnerId: number; count: string }[];
  return new Map(rows.map((r) => [r.partnerId, Number(r.count)]));
}

function view(partner: Partner, companyCount: number): PartnerView {
  return {
    id: partner.id,
    name: partner.name,
    keyPrefix: partner.keyPrefix,
    status: partner.status,
    lastUsedAt: partner.lastUsedAt,
    createdAt: partner.get("createdAt") as Date,
    companyCount,
  };
}

async function viewOne(partner: Partner): Promise<PartnerView> {
  return view(partner, (await companyCounts([partner.id])).get(partner.id) ?? 0);
}

async function partnerOr404(id: number): Promise<Partner> {
  const partner = await Partner.findByPk(id);
  if (!partner) throw notFound("Parceiro");
  return partner;
}

export async function listPartners(): Promise<PartnerView[]> {
  const partners = await Partner.findAll({ order: [["name", "ASC"], ["id", "ASC"]] });
  const counts = await companyCounts(partners.map((p) => p.id));
  return partners.map((p) => view(p, counts.get(p.id) ?? 0));
}

/** A chave volta só aqui e na regeneração; o banco guarda apenas o hash. */
export async function createPartner(name: string): Promise<{ partner: PartnerView; key: string }> {
  const { key, keyHash, keyPrefix } = generatePartnerKey();
  const partner = await Partner.create({ name, keyHash, keyPrefix });
  return { partner: view(partner, 0), key };
}

export async function updatePartner(id: number, input: { name: string }): Promise<PartnerView> {
  const partner = await partnerOr404(id);
  await partner.update(input);
  return viewOne(partner);
}

/** A chave anterior deixa de valer na hora. */
export async function regeneratePartnerKey(id: number): Promise<{ partner: PartnerView; key: string }> {
  const partner = await partnerOr404(id);
  const { key, keyHash, keyPrefix } = generatePartnerKey();
  await partner.update({ keyHash, keyPrefix });
  return { partner: await viewOne(partner), key };
}

/** Revogar só recusa a API de parceiros; os tokens das conexões já emitidos continuam valendo. */
export async function setPartnerStatus(id: number, status: PartnerStatus): Promise<PartnerView> {
  const partner = await partnerOr404(id);
  await partner.update({ status });
  return viewOne(partner);
}
