import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../shared/http";
import { currentAuth, isAuth } from "../auth/auth.middleware";
import { cancelScheduled, createScheduled, listScheduled } from "./scheduled.service";

const createSchema = z.object({
  body: z.string().trim().min(1, "informe o texto").max(4096),
  sendAt: z.coerce.date(),
});

export const scheduledRoutes = Router();

scheduledRoutes.get("/tickets/:ticketId/scheduled", isAuth, async (req, res) => {
  res.json(await listScheduled(currentAuth(req), idParam(req, "ticketId")));
});

scheduledRoutes.post("/tickets/:ticketId/scheduled", isAuth, async (req, res) => {
  res.status(201).json(await createScheduled(currentAuth(req), idParam(req, "ticketId"), createSchema.parse(req.body)));
});

scheduledRoutes.delete("/scheduled/:id", isAuth, async (req, res) => {
  res.json(await cancelScheduled(currentAuth(req), idParam(req)));
});
