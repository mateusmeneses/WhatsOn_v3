import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../shared/http";
import { currentAuth, isAuth, requireProfile } from "../auth/auth.middleware";
import {
  createConnection,
  deleteConnection,
  disconnectConnection,
  getConnectionApiToken,
  getConnectionQrCode,
  listConnections,
  publicConnection,
  regenerateConnectionApiToken,
  updateConnection,
} from "./connections.service";

const connectionSchema = z.object({
  name: z.string().trim().min(1).max(60),
  isDefault: z.boolean().optional(),
  defaultQueueId: z.number().int().positive().nullable().optional(),
  outOfHoursMessage: z.string().max(2000).optional(),
  closingMessage: z.string().max(2000).optional(),
  transferMessage: z.string().max(2000).optional(),
  botTimeoutMinutes: z.number().int().min(1).max(1440).optional(),
});

export const connectionRoutes = Router();
connectionRoutes.use(isAuth);

connectionRoutes.get("/", async (req, res) => {
  const connections = await listConnections(currentAuth(req).companyId);
  res.json(connections.map(publicConnection));
});

connectionRoutes.post("/", requireProfile("admin"), async (req, res) => {
  const input = connectionSchema.parse(req.body);
  res.status(201).json(publicConnection(await createConnection(currentAuth(req).companyId, input)));
});

connectionRoutes.put("/:id", requireProfile("admin"), async (req, res) => {
  const input = connectionSchema.partial().parse(req.body);
  res.json(publicConnection(await updateConnection(currentAuth(req).companyId, idParam(req), input)));
});

connectionRoutes.delete("/:id", requireProfile("admin"), async (req, res) => {
  await deleteConnection(currentAuth(req).companyId, idParam(req));
  res.status(204).end();
});

connectionRoutes.get("/:id/qrcode", requireProfile("admin"), async (req, res) => {
  res.json(await getConnectionQrCode(currentAuth(req).companyId, idParam(req)));
});

connectionRoutes.get("/:id/api-token", requireProfile("admin"), async (req, res) => {
  res.json(await getConnectionApiToken(currentAuth(req).companyId, idParam(req)));
});

connectionRoutes.post("/:id/api-token", requireProfile("admin"), async (req, res) => {
  res.json(await regenerateConnectionApiToken(currentAuth(req).companyId, idParam(req)));
});

connectionRoutes.post("/:id/disconnect", requireProfile("admin"), async (req, res) => {
  res.json(publicConnection(await disconnectConnection(currentAuth(req).companyId, idParam(req))));
});
