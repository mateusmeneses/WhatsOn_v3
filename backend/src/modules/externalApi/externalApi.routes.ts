import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { env } from "../../config/env";
import { apiTokenAuth, currentConnection } from "./apiToken.middleware";
import {
  checkNumber,
  connectionLogout,
  connectionQrCode,
  connectionStatus,
  sendMediaUrl,
  sendMessage,
} from "./externalApi.service";
import { rateLimitByConnection } from "./rateLimit";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024, files: 10 } });

const number = z
  .union([z.string(), z.number()])
  .transform(String)
  .pipe(z.string().trim().min(1, "informe o número"));

const sendSchema = z.object({ number, body: z.string().max(4096).optional() });

const sendMediaUrlSchema = z.object({
  number,
  url: z.string().trim().url(),
  caption: z.string().max(1024).optional(),
  fileName: z.string().trim().max(255).optional(),
});

const checkSchema = z.object({ number });

/** API externa (/api/v1), autenticada pelo token de API de uma conexão. */
export const externalApiRoutes = Router();
externalApiRoutes.use(apiTokenAuth, rateLimitByConnection(env.EXTERNAL_API_RATE_LIMIT));

externalApiRoutes.get("/connection/status", (req, res) => {
  res.json(connectionStatus(currentConnection(req)));
});

externalApiRoutes.get("/connection/qrcode", async (req, res) => {
  res.json(await connectionQrCode(currentConnection(req)));
});

externalApiRoutes.post("/connection/logout", async (req, res) => {
  res.json(await connectionLogout(currentConnection(req)));
});

externalApiRoutes.post("/messages/send", upload.array("medias"), async (req, res) => {
  const input = sendSchema.parse(req.body);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  res.status(201).json(await sendMessage(currentConnection(req), { ...input, files }));
});

externalApiRoutes.post("/messages/send-media-url", async (req, res) => {
  res.status(201).json(await sendMediaUrl(currentConnection(req), sendMediaUrlSchema.parse(req.body)));
});

externalApiRoutes.post("/contacts/check", async (req, res) => {
  res.json(await checkNumber(currentConnection(req), checkSchema.parse(req.body).number));
});
