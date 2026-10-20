import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/errors/AppError";
import { currentAuth, isAuth, requireProfile } from "../auth/auth.middleware";
import { companyTimezone, getDashboard, MAX_RANGE_DAYS, resolveRange } from "./dashboard.service";
import { getMyPerformance } from "./performance.service";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use o formato AAAA-MM-DD").refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "data inválida");

const querySchema = z.object({
  period: z.enum(["today", "yesterday", "7d", "30d", "90d", "custom"]).default("7d"),
  from: day.optional(),
  to: day.optional(),
});

export const dashboardRoutes = Router();
dashboardRoutes.use(isAuth);

async function rangeFor(req: Parameters<typeof currentAuth>[0]) {
  const query = querySchema.parse(req.query);
  const { companyId } = currentAuth(req);
  if (query.period === "custom" && (!query.from || !query.to)) {
    throw new AppError("INVALID_RANGE", 400, "Informe a data inicial e a final");
  }
  const range = resolveRange(query.period, await companyTimezone(companyId), query);
  if (range.days > MAX_RANGE_DAYS) throw new AppError("INVALID_RANGE", 400, `O período máximo é de ${MAX_RANGE_DAYS} dias`);
  return range;
}

/** Desempenho do próprio usuário: qualquer perfil, sempre só os dados dele. */
dashboardRoutes.get("/me", async (req, res) => {
  const { companyId, userId } = currentAuth(req);
  res.json(await getMyPerformance(companyId, userId, await rangeFor(req)));
});

/** Painel estatístico da empresa: só admin e supervisor. */
dashboardRoutes.get("/", requireProfile("admin", "supervisor"), async (req, res) => {
  res.json(await getDashboard(currentAuth(req).companyId, await rangeFor(req)));
});
