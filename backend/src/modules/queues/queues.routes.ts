import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../shared/http";
import { currentAuth, isAuth, requireProfile } from "../auth/auth.middleware";
import { createQueue, deleteQueue, listQueues, updateQueue } from "./queues.service";

const RANGE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

export const scheduleSchema = z.record(
  z.enum(["0", "1", "2", "3", "4", "5", "6"]),
  z.array(
    z
      .string()
      .regex(RANGE, "use o formato HH:mm-HH:mm")
      .refine((r) => {
        const [start, end] = r.split("-");
        return start < end;
      }, "o início deve ser antes do fim"),
  ),
);

const queueSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  schedule: scheduleSchema.optional(),
});

export const queueRoutes = Router();
queueRoutes.use(isAuth);

queueRoutes.get("/", async (req, res) => {
  res.json(await listQueues(currentAuth(req).companyId));
});

queueRoutes.post("/", requireProfile("admin"), async (req, res) => {
  const input = queueSchema.parse(req.body);
  res.status(201).json(await createQueue(currentAuth(req).companyId, input));
});

queueRoutes.put("/:id", requireProfile("admin"), async (req, res) => {
  const input = queueSchema.partial().parse(req.body);
  res.json(await updateQueue(currentAuth(req).companyId, idParam(req), input));
});

queueRoutes.delete("/:id", requireProfile("admin"), async (req, res) => {
  await deleteQueue(currentAuth(req).companyId, idParam(req));
  res.status(204).end();
});
