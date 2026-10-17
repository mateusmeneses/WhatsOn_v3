import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../shared/http";
import { currentAuth, isAuth, requireProfile } from "../auth/auth.middleware";
import { createUser, deleteUser, listUserOptions, listUsers, resetAccess, updateUser } from "./users.service";

const userSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(6).max(100).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  profile: z.enum(["admin", "supervisor", "agent"]),
  queueIds: z.array(z.number().int().positive()).optional(),
  canViewBot: z.boolean().optional(),
  canViewOtherQueues: z.boolean().optional(),
  canViewOthersOpen: z.boolean().optional(),
});

export const userRoutes = Router();
userRoutes.use(isAuth);

userRoutes.get("/", requireProfile("admin", "supervisor"), async (req, res) => {
  res.json(await listUsers(currentAuth(req).companyId));
});

// Antes das rotas "/:id". Todo perfil autenticado (agentes precisam para transferir).
userRoutes.get("/options", async (req, res) => {
  res.json(await listUserOptions(currentAuth(req).companyId));
});

const createUserSchema = userSchema.extend({ sendAccess: z.boolean().optional() });

userRoutes.post("/", requireProfile("admin"), async (req, res) => {
  const input = createUserSchema.parse(req.body);
  res.status(201).json(await createUser(currentAuth(req).companyId, input));
});

userRoutes.put("/:id", requireProfile("admin"), async (req, res) => {
  const input = userSchema.partial().parse(req.body);
  const auth = currentAuth(req);
  res.json(await updateUser(auth.companyId, idParam(req), input, auth.userId));
});

userRoutes.post("/:id/reset-access", requireProfile("admin"), async (req, res) => {
  res.json(await resetAccess(currentAuth(req).companyId, idParam(req)));
});

userRoutes.delete("/:id", requireProfile("admin"), async (req, res) => {
  await deleteUser(currentAuth(req), idParam(req));
  res.status(204).end();
});
