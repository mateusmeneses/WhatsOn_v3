import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/errors/AppError";
import { currentAuth, isAuth, requireProfile } from "../auth/auth.middleware";
import { companyTimezone, getDashboard, MAX_RANGE_DAYS, resolveRange } from "./dashboard.service";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use o formato AAAA-MM-DD").refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "data inválida");

const querySchema = z.object({
  period: z.enum(["today", "yesterday", "7d", "30d", "90d", "custom"]).default("7d"),
  from: day.optional(),
  to: day.optional(),
});

export const dashboardRoutes = Router();
dashboardRoutes.use(isAuth);

/** Painel estatístico da empresa: só admin e supervisor. */
dashboardRoutes.get("/", requireProfile("admin", "supervisor"), async (req, res) => {
  const query = querySchema.parse(req.query);
  const { companyId } = currentAuth(req);
  if (query.period === "custom" && (!query.from || !query.to)) {
    throw new AppError("INVALID_RANGE", 400, "Informe a data inicial e a final");
  }
  const range = resolveRange(query.period, await companyTimezone(companyId), query);
  if (range.days > MAX_RANGE_DAYS) throw new AppError("INVALID_RANGE", 400, `O período máximo é de ${MAX_RANGE_DAYS} dias`);
  res.json(await getDashboard(companyId, range));
});
