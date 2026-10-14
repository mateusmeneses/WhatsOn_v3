import { Router } from "express";
import { Connection } from "../../models";
import { AppError } from "../../shared/errors/AppError";
import { getProvider } from "../whatsapp/registry";
import { enqueueInbound } from "./inbound";

const TOKEN_CACHE_TTL_MS = 60_000;
const tokenCache = new Map<string, { connectionId: number; expiresAt: number }>();

export function clearWebhookCache(): void {
  tokenCache.clear();
}

async function connectionIdForToken(token: string): Promise<number | null> {
  const hit = tokenCache.get(token);
  if (hit && hit.expiresAt > Date.now()) return hit.connectionId;
  const connection = await Connection.findOne({ where: { webhookToken: token }, attributes: ["id"] });
  if (!connection) return null;
  tokenCache.set(token, { connectionId: connection.id, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
  return connection.id;
}

export const webhookRoutes = Router();

webhookRoutes.post("/evolution/:token", async (req, res) => {
  const connectionId = await connectionIdForToken(req.params.token);
  if (!connectionId) throw new AppError("NOT_FOUND", 404, "Webhook desconhecido");
  for (const event of getProvider().parseWebhook(req.body)) await enqueueInbound(connectionId, event);
  res.json({ ok: true });
});
