import { Router } from "express";
import { z } from "zod";
import { idParam, pageParam } from "../../shared/http";
import { currentAuth, isAuth } from "../auth/auth.middleware";
import { contactStats, deleteContact, getContactOr404, listContacts, updateContact } from "./contacts.service";

export const contactRoutes = Router();
contactRoutes.use(isAuth);

contactRoutes.get("/", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  res.json(await listContacts(currentAuth(req).companyId, { search, page: pageParam(req.query.page) }));
});

// Antes de "/:id". ?ids=1,2,3
contactRoutes.get("/stats", async (req, res) => {
  const ids = String(req.query.ids ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  res.json(await contactStats(currentAuth(req).companyId, ids));
});

contactRoutes.get("/:id", async (req, res) => {
  res.json(await getContactOr404(currentAuth(req).companyId, idParam(req)));
});

contactRoutes.put("/:id", async (req, res) => {
  const input = z.object({ name: z.string().trim().min(1).max(120) }).parse(req.body);
  res.json(await updateContact(currentAuth(req).companyId, idParam(req), input));
});

contactRoutes.delete("/:id", async (req, res) => {
  await deleteContact(currentAuth(req).companyId, idParam(req));
  res.status(204).end();
});
