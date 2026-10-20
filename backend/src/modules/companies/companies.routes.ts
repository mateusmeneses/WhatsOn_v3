import { Router } from "express";
import { z } from "zod";
import { Company } from "../../models";
import { notFound } from "../../shared/errors/AppError";
import { currentAuth, isAuth, requireProfile } from "../auth/auth.middleware";

export const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const companySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  timezone: z.string().refine(isTimeZone, "fuso horário inválido").optional(),
  responseSlaMinutes: z.number().int().min(1).max(240).optional(),
});

async function myCompany(companyId: number): Promise<Company> {
  const company = await Company.findByPk(companyId);
  if (!company) throw notFound("Empresa");
  return company;
}

export const companyRoutes = Router();
companyRoutes.use(isAuth);

companyRoutes.get("/", async (req, res) => {
  res.json(await myCompany(currentAuth(req).companyId));
});

companyRoutes.put("/", requireProfile("admin"), async (req, res) => {
  const input = companySchema.parse(req.body);
  const company = await myCompany(currentAuth(req).companyId);
  res.json(await company.update(input));
});
