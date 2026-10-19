import { Router } from "express";
import { z } from "zod";
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
