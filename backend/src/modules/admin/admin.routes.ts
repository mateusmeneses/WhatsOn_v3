import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../shared/http";
import { currentSession, isSession, requireSuperAdmin } from "../auth/auth.middleware";
import { isTimeZone } from "../companies/companies.routes";
import { createCompany, enterCompany, exitCompany, listCompanies, setCompanyBlocked, updateCompany } from "./admin.service";

const name = z.string().trim().min(1).max(80);
const timezone = z.string().refine(isTimeZone, "fuso horário inválido");

const updateSchema = z.object({ name: name.optional(), timezone: timezone.optional() });
const createSchema = z.object({
  name,
  timezone: timezone.optional(),
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
