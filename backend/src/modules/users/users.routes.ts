import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../shared/http";
import { currentAuth, isAuth, requireProfile } from "../auth/auth.middleware";
import { createUser, deleteUser, listUserOptions, listUsers, updateUser } from "./users.service";

const userSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  profile: z.enum(["admin", "supervisor", "agent"]),
  queueIds: z.array(z.number().int().positive()).optional(),
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

userRoutes.post("/", requireProfile("admin"), async (req, res) => {
  const input = userSchema.parse(req.body);
  res.status(201).json(await createUser(currentAuth(req).companyId, input));
});

userRoutes.put("/:id", requireProfile("admin"), async (req, res) => {
  const input = userSchema.partial().parse(req.body);
  res.json(await updateUser(currentAuth(req).companyId, idParam(req), input));
});

userRoutes.delete("/:id", requireProfile("admin"), async (req, res) => {
  await deleteUser(currentAuth(req), idParam(req));
  res.status(204).end();
});
