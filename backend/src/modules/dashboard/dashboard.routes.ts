import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/errors/AppError";
import { currentAuth, isAuth, requireProfile } from "../auth/auth.middleware";
import { companyTimezone, getDashboard, MAX_RANGE_DAYS, resolveRange } from "./dashboard.service";
import { createTtlCache } from "../../shared/ttlCache";
import { getMyPerformance } from "./performance.service";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use o formato AAAA-MM-DD").refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "data inválida");

const querySchema = z.object({
  period: z.enum(["today", "yesterday", "7d", "30d", "90d", "custom"]).default("7d"),
  from: day.optional(),
  to: day.optional(),
});

export const dashboardRoutes = Router();
dashboardRoutes.use(isAuth);

/** Painéis pesados: 20 s de cache (e uma só consulta para quem abre ao mesmo tempo). Desligado nos testes. */
const cache = createTtlCache({ ttlMs: 20_000, enabled: process.env.NODE_ENV !== "test" });

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
  const range = await rangeFor(req);
  res.json(await cache.get(`me:${companyId}:${userId}:${range.from}:${range.to}`, () => getMyPerformance(companyId, userId, range)));
});

/** Painel estatístico da empresa: só admin e supervisor. */
dashboardRoutes.get("/", requireProfile("admin", "supervisor"), async (req, res) => {
  const { companyId } = currentAuth(req);
  const range = await rangeFor(req);
  res.json(await cache.get(`dash:${companyId}:${range.from}:${range.to}`, () => getDashboard(companyId, range)));
});
