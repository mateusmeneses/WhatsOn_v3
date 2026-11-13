import { Request, Router } from "express";
import multer from "multer";
import { z } from "zod";
import { env } from "../../config/env";
import { AppError } from "../../shared/errors/AppError";
import {
  apiAccept,
  apiAppendNote,
  apiClose,
  apiListMessages,
  apiNotes,
  apiPresence,
  apiSendMessage,
  apiTransfer,
  claudiaAuth,
} from "../claudia/claudia.api";
import { listClaudiaEvents } from "../claudia/claudia.replay";
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

const replaySchema = z.object({
  desde: z.string().datetime({ offset: true }).transform((v) => new Date(v)).optional(),
  apos_id: z.coerce.number().int().nonnegative().optional(),
  limite: z.coerce.number().int().min(1).max(500).default(100),
});

// --- API de ações da Claudia: tudo como o usuário CLAUDIA_USER_ID, só na empresa da Claudia. ---
const conversationId = (req: Request) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError("VALIDATION_ERROR", 400, "Conversa inválida");
  return id;
};
const claudia = (req: Request) => claudiaAuth(currentConnection(req));

externalApiRoutes.post("/conversas/:id/aceitar", async (req, res) => {
  const { auth } = await claudia(req);
  res.json(await apiAccept(auth, conversationId(req)));
});

const claudiaMessageSchema = z.object({ texto: z.string().trim().min(1).max(4096), assinar: z.boolean().optional() });
externalApiRoutes.post("/conversas/:id/mensagens", async (req, res) => {
  const { auth } = await claudia(req);
  res.status(201).json(await apiSendMessage(auth, conversationId(req), claudiaMessageSchema.parse(req.body)));
});

const listLimitSchema = z.object({ limite: z.coerce.number().int().min(1).max(100).default(20) });
externalApiRoutes.get("/conversas/:id/mensagens", async (req, res) => {
  const { auth, cfg } = await claudia(req);
  res.json(await apiListMessages(cfg, auth, conversationId(req), listLimitSchema.parse(req.query).limite));
});

externalApiRoutes.get("/conversas/:id/observacoes", async (req, res) => {
  const { auth } = await claudia(req);
  res.json(await apiNotes(auth, conversationId(req)));
});

const noteSchema = z.object({ texto: z.string().trim().min(1).max(2000) });
externalApiRoutes.post("/conversas/:id/observacoes", async (req, res) => {
  const { auth } = await claudia(req);
  res.status(201).json(await apiAppendNote(auth, conversationId(req), noteSchema.parse(req.body).texto));
});

const transferSchema = z
  .object({ usuario_id: z.number().int().positive().optional(), fila_id: z.number().int().positive().optional() })
  .refine((v) => v.usuario_id || v.fila_id, "informe usuario_id ou fila_id");
externalApiRoutes.post("/conversas/:id/transferir", async (req, res) => {
  const { auth } = await claudia(req);
  res.json(await apiTransfer(auth, conversationId(req), transferSchema.parse(req.body)));
});

const closeSchema = z.object({ enviar_mensagem: z.boolean().default(true) });
externalApiRoutes.post("/conversas/:id/finalizar", async (req, res) => {
  const { auth } = await claudia(req);
  res.json(await apiClose(auth, conversationId(req), closeSchema.parse(req.body ?? {}).enviar_mensagem));
});

externalApiRoutes.get("/usuarios/presenca", async (req, res) => {
  const { auth, cfg } = await claudia(req);
  res.json(await apiPresence(cfg, auth.companyId));
});

// Avisos enviados à Claudia, para ela recuperar os que perdeu (só na empresa da Claudia).
externalApiRoutes.get("/webhook/eventos", async (req, res) => {
  const q = replaySchema.parse(req.query);
  res.json(await listClaudiaEvents(currentConnection(req).companyId, { desde: q.desde, aposId: q.apos_id, limite: q.limite }));
});
