import { Router } from "express";
import { z } from "zod";
import { currentSession, isSession } from "./auth.middleware";
import { changePassword, login, logout, me, refresh } from "./auth.service";

export const authRoutes = Router();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6, "a nova senha deve ter pelo menos 6 caracteres").max(100),
});

authRoutes.post("/login", async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  res.json(await login(email, password));
});

authRoutes.post("/refresh", async (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  res.json(await refresh(refreshToken));
});

authRoutes.post("/logout", isSession, async (req, res) => {
  await logout(currentSession(req).userId);
  res.status(204).end();
});

authRoutes.post("/change-password", isSession, async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  res.json(await changePassword(currentSession(req), currentPassword, newPassword));
});

authRoutes.get("/me", isSession, async (req, res) => {
  res.json(await me(currentSession(req)));
});
