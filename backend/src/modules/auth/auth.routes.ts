import { Router } from "express";
import { z } from "zod";
import { currentAuth, isAuth } from "./auth.middleware";
import { login, logout, me, refresh } from "./auth.service";

export const authRoutes = Router();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });

authRoutes.post("/login", async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  res.json(await login(email, password));
});

authRoutes.post("/refresh", async (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  res.json(await refresh(refreshToken));
});

authRoutes.post("/logout", isAuth, async (req, res) => {
  await logout(currentAuth(req).userId);
  res.status(204).end();
});

authRoutes.get("/me", isAuth, async (req, res) => {
  res.json(await me(currentAuth(req)));
});
