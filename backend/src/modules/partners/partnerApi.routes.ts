import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { normalizeCnpj } from "../../shared/cnpj";
import { rateLimitBy } from "../externalApi/rateLimit";
import { currentPartner, partnerKeyAuth } from "./partnerKey.middleware";
import { getPartnerCompany, regeneratePartnerCompanyToken, upsertPartnerCompany } from "./partnerApi.service";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : v === undefined ? undefined : null));

const upsertSchema = z.object({
  cnpj: z.string().transform(normalizeCnpj),
  name: z.string().trim().min(1).max(200),
  tradeName: optionalText(200),
  email: z
    .string()
    .trim()
    .email()
    .max(200)
    .nullish()
    .or(z.literal("").transform(() => null)),
  phone: optionalText(30),
});

/** API de parceiros (/api/partner/v1): sistemas parceiros criam empresas, conexões e tokens pelo CNPJ. */
export const partnerApiRoutes = Router();
partnerApiRoutes.use(partnerKeyAuth, rateLimitBy("partnerapi:rl", (req) => req.partner?.id, env.PARTNER_API_RATE_LIMIT));

partnerApiRoutes.post("/companies", async (req, res) => {
  const { created, result } = await upsertPartnerCompany(currentPartner(req), upsertSchema.parse(req.body));
  res.status(created ? 201 : 200).json(result);
});

partnerApiRoutes.get("/companies/:cnpj", async (req, res) => {
  res.json(await getPartnerCompany(currentPartner(req), normalizeCnpj(req.params.cnpj)));
});

partnerApiRoutes.post("/companies/:cnpj/api-token", async (req, res) => {
  res.json(await regeneratePartnerCompanyToken(currentPartner(req), normalizeCnpj(req.params.cnpj)));
});
