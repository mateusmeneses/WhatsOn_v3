import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/errors/AppError";
import { idParam } from "../../shared/http";
import { currentAuth, isAuth } from "../auth/auth.middleware";
import { isManagerEnabled } from "./manager.client";
import { clientContacts, getCatalog, openOs, registerAtendimento, searchClients } from "./manager.service";

const id = z.number().int().positive();

const osSchema = z.object({
  titulo: z.string().trim().min(1).max(200),
  descricao: z.string().max(5000).default(""),
  prioridade: z.number().int().min(1).max(4).default(2),
  codCliente: id,
  codSolicitante: id.optional(),
  codContrato: id.optional(),
  codResponsavel: id.optional(),
  dtVencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const atendimentoSchema = z.object({
  codCliente: id,
  codSolicitante: id.optional(),
  codProduto: id.optional(),
  codTipoAtendimento: id.optional(),
  codTecnico: id.optional(),
  prioridade: z.number().int().min(1).max(3).optional(),
  descricao: z.string().trim().min(1).max(500),
});

const searchSchema = z.object({
  ticketId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().min(2).max(100).optional(),
});

/** Só a empresa configurada em MANAGER_COMPANY_ID enxerga a integração; as demais recebem 404. */
function requireManager(req: Request, _res: Response, next: NextFunction): void {
  if (!isManagerEnabled(currentAuth(req).companyId)) {
    next(new AppError("MANAGER_DISABLED", 404, "Integração com o Manager não está ativa"));
    return;
  }
  next();
}

// Montado na raiz de /api: isAuth por rota, para não responder 401 em rotas inexistentes (que devem dar 404).
export const managerRoutes = Router();

managerRoutes.get("/manager/status", isAuth, (req, res) => {
  res.json({ enabled: isManagerEnabled(currentAuth(req).companyId) });
});

managerRoutes.get("/manager/clients", isAuth, requireManager, async (req, res) => {
  res.json(await searchClients(currentAuth(req), searchSchema.parse(req.query)));
});

managerRoutes.get("/manager/clients/:id/contacts", isAuth, requireManager, async (req, res) => {
  res.json(await clientContacts(idParam(req)));
});

managerRoutes.get("/manager/catalog", isAuth, requireManager, async (_req, res) => {
  res.json(await getCatalog());
});

managerRoutes.post("/tickets/:id/manager/os", isAuth, requireManager, async (req, res) => {
  res.status(201).json(await openOs(currentAuth(req), idParam(req), osSchema.parse(req.body)));
});

managerRoutes.post("/tickets/:id/manager/atendimento", isAuth, requireManager, async (req, res) => {
  res.status(201).json(await registerAtendimento(currentAuth(req), idParam(req), atendimentoSchema.parse(req.body)));
});
