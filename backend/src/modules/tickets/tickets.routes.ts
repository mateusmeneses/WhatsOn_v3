import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../shared/http";
import { currentAuth, isAuth } from "../auth/auth.middleware";
import {
  acceptTicket,
  claimTicket,
  closeTicket,
  getVisibleTicket,
  listTickets,
  loadTicket,
  markTicketRead,
  reopenTicket,
  ticketAttendants,
  ticketSummary,
  ticketHistory,
  transferTicket,
  updateTicketNotes,
} from "./tickets.service";

const listSchema = z.object({
  status: z.enum(["bot", "pending", "open", "closed"]).default("pending"),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  mine: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
});

const transferSchema = z
  .object({ queueId: z.number().int().positive().optional(), userId: z.number().int().positive().optional() })
  .refine((v) => v.queueId !== undefined || v.userId !== undefined, "informe a fila ou o atendente");

const closeSchema = z.object({ sendClosingMessage: z.boolean().optional() });

const notesSchema = z.object({ notes: z.string().max(5000) });

const claimSchema = z.object({ note: z.string().max(1000).optional() });

export const ticketRoutes = Router();
ticketRoutes.use(isAuth);

ticketRoutes.get("/", async (req, res) => {
  res.json(await listTickets(currentAuth(req), listSchema.parse(req.query)));
});

// Antes de "/:id".
ticketRoutes.get("/summary", async (req, res) => {
  res.json(await ticketSummary(currentAuth(req)));
});

ticketRoutes.get("/:id", async (req, res) => {
  const ticket = await getVisibleTicket(currentAuth(req), idParam(req));
  res.json(await loadTicket(ticket.id));
});

ticketRoutes.get("/:id/attendants", async (req, res) => {
  res.json(await ticketAttendants(await getVisibleTicket(currentAuth(req), idParam(req))));
});

ticketRoutes.get("/:id/history", async (req, res) => {
  res.json(await ticketHistory(await getVisibleTicket(currentAuth(req), idParam(req))));
});

ticketRoutes.post("/:id/accept", async (req, res) => {
  res.json(await acceptTicket(currentAuth(req), idParam(req)));
});

ticketRoutes.post("/:id/claim", async (req, res) => {
  res.json(await claimTicket(currentAuth(req), idParam(req), claimSchema.parse(req.body ?? {})));
});

ticketRoutes.post("/:id/transfer", async (req, res) => {
  res.json(await transferTicket(currentAuth(req), idParam(req), transferSchema.parse(req.body)));
});

ticketRoutes.post("/:id/close", async (req, res) => {
  res.json(await closeTicket(currentAuth(req), idParam(req), closeSchema.parse(req.body ?? {})));
});

ticketRoutes.put("/:id/notes", async (req, res) => {
  res.json(await updateTicketNotes(currentAuth(req), idParam(req), notesSchema.parse(req.body).notes));
});

ticketRoutes.post("/:id/reopen", async (req, res) => {
  res.json(await reopenTicket(currentAuth(req), idParam(req)));
});

ticketRoutes.post("/:id/read", async (req, res) => {
  res.json(await markTicketRead(currentAuth(req), idParam(req)));
});
