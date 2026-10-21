import { UniqueConstraintError } from "sequelize";
import { BotAction, ChatbotNode, Company, Connection, Queue, Ticket } from "../../models";
import { scheduleBotTimeout } from "../../queues/botTimeout";
import { AppError, notFound } from "../../shared/errors/AppError";
import { getConnectionOr404 } from "../connections/connections.service";
import { resolveMediaPath } from "../media/media.storage";
import { createOutgoingMessage } from "../messages/messages.service";
import { assertQueuesBelong } from "../queues/queues.service";
import { isOpen } from "../queues/schedule";
import { closeTicketInternal, moveToPending } from "../tickets/tickets.service";
import { getUserOr404 } from "../users/users.service";
import { BotContext, BotNode, BotState, botPath, INVALID_OPTION_MESSAGE, step, StepResult } from "./engine";

export interface NodeInput {
  parentId: number | null;
  key: string;
  title: string;
  action: BotAction;
  message?: string;
  mediaUrl?: string | null;
  mediaMime?: string | null;
  mediaName?: string | null;
  queueId?: number | null;
  userId?: number | null;
}

export function toBotNode(n: ChatbotNode): BotNode {
  return {
    id: n.id,
    parentId: n.parentId,
    order: n.order,
    key: n.key,
    title: n.title,
    action: n.action,
    message: n.message,
    mediaUrl: n.mediaUrl,
    mediaMime: n.mediaMime,
    mediaName: n.mediaName,
    queueId: n.queueId,
    userId: n.userId,
  };
}

export async function loadTree(connectionId: number): Promise<BotNode[]> {
  return (await ChatbotNode.findAll({ where: { connectionId } })).map(toBotNode);
}

export async function hasBot(connectionId: number): Promise<boolean> {
  return (await ChatbotNode.count({ where: { connectionId, parentId: null } })) > 0;
}

export async function buildBotContext(connection: Connection, nodes: BotNode[], now = new Date()): Promise<BotContext> {
  const [company, queues] = await Promise.all([
    Company.findByPk(connection.companyId),
    Queue.findAll({ where: { companyId: connection.companyId } }),
  ]);
  const timeZone = company?.timezone ?? "America/Sao_Paulo";
  return {
    nodes,
    defaultQueueId: connection.defaultQueueId,
    isQueueOpen: (queueId) => {
      const queue = queues.find((q) => q.id === queueId);
      return queue ? isOpen(queue.schedule, now, timeZone) : true;
    },
    messages: {
      transfer: connection.transferMessage,
      outOfHours: connection.outOfHoursMessage,
      invalid: INVALID_OPTION_MESSAGE,
    },
  };
}

export async function listNodes(companyId: number, connectionId: number) {
  await getConnectionOr404(companyId, connectionId);
  return ChatbotNode.findAll({
    where: { connectionId },
    order: [
      ["parentId", "ASC NULLS FIRST"],
      ["order", "ASC"],
      ["id", "ASC"],
    ],
  });
}

async function getNodeOr404(companyId: number, id: number): Promise<ChatbotNode> {
  const node = await ChatbotNode.findOne({ where: { id, companyId } });
  if (!node) throw notFound("Opção do chatbot");
  return node;
}

async function validateNode(companyId: number, connectionId: number, input: NodeInput): Promise<void> {
  if (input.parentId !== null) {
    const parent = await ChatbotNode.findOne({ where: { id: input.parentId, connectionId } });
    if (!parent) throw new AppError("INVALID_PARENT", 400, "Opção pai inválida");
    if (parent.parentId !== null && parent.action !== "submenu") {
      throw new AppError("INVALID_PARENT", 400, "Só submenus podem ter opções");
    }
  }
  if (input.action === "transfer_queue" && !input.queueId) {
    throw new AppError("QUEUE_REQUIRED", 400, "Selecione a fila de destino");
  }
  if (input.action === "transfer_agent" && !input.userId) {
    throw new AppError("USER_REQUIRED", 400, "Selecione o atendente");
  }
  if (input.queueId) await assertQueuesBelong(companyId, [input.queueId]);
  if (input.userId) await getUserOr404(companyId, input.userId);
  if (input.mediaUrl) resolveMediaPath(companyId, input.mediaUrl);
}

function rethrowUnique(err: unknown): never {
  if (err instanceof UniqueConstraintError) {
    throw new AppError("KEY_IN_USE", 409, "Já existe uma opção com este número neste menu");
  }
  throw err;
}

const ROOT_FIELDS = { key: "", action: "submenu" as BotAction, queueId: null, userId: null };

export async function createNode(companyId: number, connectionId: number, input: NodeInput) {
  await getConnectionOr404(companyId, connectionId);
  const isRoot = input.parentId === null;
  if (isRoot && (await hasBot(connectionId))) {
    throw new AppError("ROOT_EXISTS", 409, "O chatbot desta conexão já tem uma mensagem inicial");
  }
  const data: NodeInput = isRoot ? { ...input, ...ROOT_FIELDS, title: input.title || "Início" } : input;
  await validateNode(companyId, connectionId, data);
  const maxOrder = isRoot ? 0 : ((await ChatbotNode.max("order", { where: { parentId: input.parentId } })) as number | null);
  try {
    return await ChatbotNode.create({ companyId, connectionId, ...data, order: isRoot ? 0 : (maxOrder ?? 0) + 1 });
  } catch (err) {
    rethrowUnique(err);
  }
}

export async function updateNode(companyId: number, id: number, input: Partial<Omit<NodeInput, "parentId">>) {
  const node = await getNodeOr404(companyId, id);
  const pick = <K extends keyof Omit<NodeInput, "parentId">>(k: K) =>
    (input[k] !== undefined ? input[k] : node[k]) as NodeInput[K];
  const merged: NodeInput = {
    parentId: node.parentId,
    key: pick("key"),
    title: pick("title"),
    action: pick("action"),
    message: pick("message") ?? "",
    mediaUrl: pick("mediaUrl") ?? null,
    mediaMime: pick("mediaMime") ?? null,
    mediaName: pick("mediaName") ?? null,
    queueId: pick("queueId") ?? null,
    userId: pick("userId") ?? null,
    ...(node.parentId === null ? ROOT_FIELDS : {}),
  };
  if (merged.action !== "submenu" && (await ChatbotNode.count({ where: { parentId: node.id } })) > 0) {
    throw new AppError("HAS_CHILDREN", 400, "Remova as opções internas antes de mudar o tipo deste submenu");
  }
  await validateNode(companyId, node.connectionId, merged);
  try {
    return await node.update(merged);
  } catch (err) {
    rethrowUnique(err);
  }
}

export async function deleteNode(companyId: number, id: number): Promise<void> {
  const node = await getNodeOr404(companyId, id);
  await node.destroy();
}

export async function reorderChildren(companyId: number, parentId: number, ids: number[]) {
  await getNodeOr404(companyId, parentId);
  const children = await ChatbotNode.findAll({ where: { parentId } });
  const current = children.map((c) => c.id).sort((a, b) => a - b);
  const requested = [...ids].sort((a, b) => a - b);
  if (current.length !== requested.length || current.some((id, i) => id !== requested[i])) {
    throw new AppError("INVALID_ORDER", 400, "A nova ordem precisa conter exatamente as opções deste menu");
  }
  await Promise.all(ids.map((id, index) => ChatbotNode.update({ order: index + 1 }, { where: { id } })));
  return ChatbotNode.findAll({ where: { parentId }, order: [["order", "ASC"]] });
}

export async function simulate(
  companyId: number,
  connectionId: number,
  state: BotState,
  input: string | null,
): Promise<StepResult> {
  const connection = await getConnectionOr404(companyId, connectionId);
  const nodes = await loadTree(connectionId);
  return step(state, input, await buildBotContext(connection, nodes));
}

export async function runBot(ticket: Ticket, input: string | null): Promise<void> {
  const connection = await Connection.findByPk(ticket.connectionId);
  if (!connection) return;
  const ctx = await buildBotContext(connection, await loadTree(connection.id));
  const state = { nodeId: ticket.chatbotNodeId, attempts: ticket.chatbotAttempts };
  const result = step(state, input, ctx);

  const path = botPath(ctx.nodes, state, input);
  if (path !== ticket.botPath) await ticket.update({ botPath: path });

  for (const effect of result.effects) {
    switch (effect.type) {
      case "send_text":
        await createOutgoingMessage(ticket, { body: effect.text, isBot: true });
        break;
      case "send_media":
        await createOutgoingMessage(ticket, { body: effect.caption, media: effect.media, isBot: true });
        break;
      case "transfer":
        await moveToPending(ticket, effect.queueId, effect.userId);
        break;
      case "close":
        await closeTicketInternal(ticket, { userId: null, event: "closed", sendClosingMessage: false, onlyFromBot: true });
        break;
    }
  }

  if (!result.finished) {
    await ticket.update({ chatbotNodeId: result.state.nodeId, chatbotAttempts: result.state.attempts });
    await scheduleBotTimeout(ticket.id, connection.botTimeoutMinutes);
  }
}
