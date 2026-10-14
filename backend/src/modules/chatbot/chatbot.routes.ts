import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../shared/http";
import { currentAuth, isAuth, requireProfile } from "../auth/auth.middleware";
import { createNode, deleteNode, listNodes, reorderChildren, simulate, updateNode } from "./chatbot.service";

const nodeFields = {
  key: z.string().regex(/^[1-9]\d?$/, "use um número de 1 a 99"),
  title: z.string().trim().min(1).max(60),
  action: z.enum(["submenu", "reply", "transfer_queue", "transfer_agent", "close"]),
  message: z.string().max(4096),
  mediaUrl: z.string().nullable(),
  mediaMime: z.string().nullable(),
  mediaName: z.string().nullable(),
  queueId: z.number().int().positive().nullable(),
  userId: z.number().int().positive().nullable(),
};

const createSchema = z
  .object({
    parentId: z.number().int().positive().nullable(),
    key: nodeFields.key.optional(),
    title: nodeFields.title.optional(),
    action: nodeFields.action.optional(),
    message: nodeFields.message.optional(),
    mediaUrl: nodeFields.mediaUrl.optional(),
    mediaMime: nodeFields.mediaMime.optional(),
    mediaName: nodeFields.mediaName.optional(),
    queueId: nodeFields.queueId.optional(),
    userId: nodeFields.userId.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.parentId === null) return;
    for (const field of ["key", "title", "action"] as const) {
      if (!v[field]) ctx.addIssue({ code: "custom", path: [field], message: "obrigatório" });
    }
  });

const updateSchema = z.object(nodeFields).partial();
const orderSchema = z.object({ ids: z.array(z.number().int().positive()) });
const simulateSchema = z.object({
  state: z.object({ nodeId: z.number().int().positive().nullable(), attempts: z.number().int().min(0) }),
  input: z.string().max(4096).nullable(),
});

export const chatbotRoutes = Router();

chatbotRoutes.get("/connections/:connectionId/chatbot", isAuth, requireProfile("admin", "supervisor"), async (req, res) => {
  res.json(await listNodes(currentAuth(req).companyId, idParam(req, "connectionId")));
});

chatbotRoutes.post("/connections/:connectionId/chatbot/nodes", isAuth, requireProfile("admin"), async (req, res) => {
  const v = createSchema.parse(req.body);
  const node = await createNode(currentAuth(req).companyId, idParam(req, "connectionId"), {
    ...v,
    key: v.key ?? "",
    title: v.title ?? "",
    action: v.action ?? "submenu",
  });
  res.status(201).json(node);
});

chatbotRoutes.post("/connections/:connectionId/chatbot/simulate", isAuth, requireProfile("admin"), async (req, res) => {
  const { state, input } = simulateSchema.parse(req.body);
  res.json(await simulate(currentAuth(req).companyId, idParam(req, "connectionId"), state, input));
});

chatbotRoutes.put("/chatbot/nodes/:id", isAuth, requireProfile("admin"), async (req, res) => {
  res.json(await updateNode(currentAuth(req).companyId, idParam(req), updateSchema.parse(req.body)));
});

chatbotRoutes.delete("/chatbot/nodes/:id", isAuth, requireProfile("admin"), async (req, res) => {
  await deleteNode(currentAuth(req).companyId, idParam(req));
  res.status(204).end();
});

chatbotRoutes.put("/chatbot/nodes/:id/children-order", isAuth, requireProfile("admin"), async (req, res) => {
  const { ids } = orderSchema.parse(req.body);
  res.json(await reorderChildren(currentAuth(req).companyId, idParam(req), ids));
});
