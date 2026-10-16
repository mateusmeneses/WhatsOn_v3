import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../shared/http";
import { currentAuth, isAuth } from "../auth/auth.middleware";
import { deleteMessage, editMessage, listMessages, resendMessage, sendAgentMessage } from "./agentMessages.service";

const listSchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

const sendSchema = z
  .object({
    body: z.string().max(4096).optional(),
    quotedMessageId: z.number().int().positive().optional(),
    media: z.object({ url: z.string(), mime: z.string(), name: z.string().nullable() }).optional(),
  })
  .refine((v) => (v.body && v.body.trim()) || v.media, "informe um texto ou um arquivo");

export const messageRoutes = Router();

messageRoutes.get("/tickets/:ticketId/messages", isAuth, async (req, res) => {
  res.json(await listMessages(currentAuth(req), idParam(req, "ticketId"), listSchema.parse(req.query)));
});

messageRoutes.post("/tickets/:ticketId/messages", isAuth, async (req, res) => {
  const message = await sendAgentMessage(currentAuth(req), idParam(req, "ticketId"), sendSchema.parse(req.body));
  res.status(201).json(message);
});

messageRoutes.post("/messages/:id/resend", isAuth, async (req, res) => {
  res.json(await resendMessage(currentAuth(req), idParam(req)));
});

const editSchema = z.object({ body: z.string().trim().min(1, "informe o texto").max(4096) });

messageRoutes.patch("/messages/:id", isAuth, async (req, res) => {
  res.json(await editMessage(currentAuth(req), idParam(req), editSchema.parse(req.body).body));
});

messageRoutes.delete("/messages/:id", isAuth, async (req, res) => {
  res.json(await deleteMessage(currentAuth(req), idParam(req)));
});
