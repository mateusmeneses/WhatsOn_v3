import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../shared/http";
import { currentAuth, isAuth } from "../auth/auth.middleware";
import {
  acceptTicket,
  closeTicket,
  getVisibleTicket,
  listTickets,
  loadTicket,
  markTicketRead,
  reopenTicket,
  ticketAttendants,
  transferTicket,
} from "./tickets.service";

const listSchema = z.object({
  status: z.enum(["bot", "pending", "open", "closed"]).default("pending"),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

const transferSchema = z
  .object({ queueId: z.number().int().positive().optional(), userId: z.number().int().positive().optional() })
  .refine((v) => v.queueId !== undefined || v.userId !== undefined, "informe a fila ou o atendente");

const closeSchema = z.object({ sendClosingMessage: z.boolean().optional() });

export const ticketRoutes = Router();
ticketRoutes.use(isAuth);

ticketRoutes.get("/", async (req, res) => {
  res.json(await listTickets(currentAuth(req), listSchema.parse(req.query)));
});

ticketRoutes.get("/:id", async (req, res) => {
  const ticket = await getVisibleTicket(currentAuth(req), idParam(req));
  res.json(await loadTicket(ticket.id));
});

ticketRoutes.get("/:id/attendants", async (req, res) => {
  res.json(await ticketAttendants(await getVisibleTicket(currentAuth(req), idParam(req))));
});

ticketRoutes.post("/:id/accept", async (req, res) => {
  res.json(await acceptTicket(currentAuth(req), idParam(req)));
});

ticketRoutes.post("/:id/transfer", async (req, res) => {
  res.json(await transferTicket(currentAuth(req), idParam(req), transferSchema.parse(req.body)));
});

ticketRoutes.post("/:id/close", async (req, res) => {
  res.json(await closeTicket(currentAuth(req), idParam(req), closeSchema.parse(req.body ?? {})));
});

ticketRoutes.post("/:id/reopen", async (req, res) => {
  res.json(await reopenTicket(currentAuth(req), idParam(req)));
});

ticketRoutes.post("/:id/read", async (req, res) => {
  res.json(await markTicketRead(currentAuth(req), idParam(req)));
});
