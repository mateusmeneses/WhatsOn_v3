import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/errors/AppError";
import { idParam } from "../../shared/http";
import { currentSession, isSession, requireSuperAdmin } from "../auth/auth.middleware";
import { normalizeCnpj } from "../../shared/cnpj";
import { isTimeZone } from "../companies/companies.routes";
import {
  createPartner,
  listPartners,
  regeneratePartnerKey,
  setPartnerStatus,
  updatePartner,
} from "../partners/partners.service";
import { MAX_RANGE_DAYS } from "../dashboard/dashboard.service";
import { getPlatformOverview } from "./platform.service";
import { createCompany, enterCompany, exitCompany, listCompanies, setCompanyBlocked, updateCompany } from "./admin.service";

const name = z.string().trim().min(1).max(80);
const timezone = z.string().refine(isTimeZone, "fuso horário inválido");
/** Vazio ou null limpa; senão normaliza (INVALID_CNPJ se não validar). */
const cnpj = z
  .string()
  .nullish()
  .transform((v) => (v === undefined ? undefined : v === null || v.trim() === "" ? null : normalizeCnpj(v)));

const updateSchema = z.object({ name: name.optional(), timezone: timezone.optional(), cnpj });
const createSchema = z.object({
  name,
  timezone: timezone.optional(),
  cnpj,
  admin: z.object({
    name: z.string().trim().min(1).max(80),
    email: z.string().trim().email(),
    phone: z.string().trim().max(30).nullish(),
  }),
});


/** Painel do super-admin: empresas da plataforma. */
export const adminRoutes = Router();
adminRoutes.use(isSession, requireSuperAdmin);

const overviewDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use o formato AAAA-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "data inválida");
const overviewSchema = z.object({
  period: z.enum(["today", "yesterday", "7d", "30d", "90d", "custom"]).default("30d"),
  from: overviewDay.optional(),
  to: overviewDay.optional(),
});

/** Indicadores de toda a plataforma (todas as empresas, parceiros e conexões). */
adminRoutes.get("/overview", async (req, res) => {
  const query = overviewSchema.parse(req.query);
  if (query.period === "custom" && (!query.from || !query.to)) {
    throw new AppError("INVALID_RANGE", 400, "Informe a data inicial e a final");
  }
  const days = query.period === "custom" ? Math.abs(Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000 + 1 : 0;
  if (days > MAX_RANGE_DAYS) throw new AppError("INVALID_RANGE", 400, `O período máximo é de ${MAX_RANGE_DAYS} dias`);
  res.json(await getPlatformOverview(query.period, query));
});

adminRoutes.get("/companies", async (_req, res) => {
  res.json(await listCompanies());
});

adminRoutes.post("/companies", async (req, res) => {
  res.status(201).json(await createCompany(createSchema.parse(req.body)));
});

adminRoutes.put("/companies/:id", async (req, res) => {
  res.json(await updateCompany(idParam(req), updateSchema.parse(req.body)));
});

adminRoutes.post("/companies/:id/block", async (req, res) => {
  res.json(await setCompanyBlocked(idParam(req), true));
});

adminRoutes.post("/companies/:id/unblock", async (req, res) => {
  res.json(await setCompanyBlocked(idParam(req), false));
});

adminRoutes.post("/companies/:id/enter", async (req, res) => {
  res.json(await enterCompany(currentSession(req), idParam(req)));
});

adminRoutes.post("/exit", async (req, res) => {
  res.json(await exitCompany(currentSession(req)));
});

const partnerSchema = z.object({ name: z.string().trim().min(1).max(80) });

adminRoutes.get("/partners", async (_req, res) => {
  res.json(await listPartners());
});

adminRoutes.post("/partners", async (req, res) => {
  res.status(201).json(await createPartner(partnerSchema.parse(req.body).name));
});

adminRoutes.put("/partners/:id", async (req, res) => {
  res.json(await updatePartner(idParam(req), partnerSchema.parse(req.body)));
});

adminRoutes.post("/partners/:id/regenerate-key", async (req, res) => {
  res.json(await regeneratePartnerKey(idParam(req)));
});

adminRoutes.post("/partners/:id/revoke", async (req, res) => {
  res.json(await setPartnerStatus(idParam(req), "revoked"));
});

adminRoutes.post("/partners/:id/activate", async (req, res) => {
  res.json(await setPartnerStatus(idParam(req), "active"));
});
