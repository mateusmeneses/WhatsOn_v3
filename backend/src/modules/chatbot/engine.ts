import type { BotAction } from "../../models";
import type { StoredMedia } from "../media/media.storage";

export interface BotNode {
  id: number;
  parentId: number | null;
  order: number;
  key: string;
  title: string;
  action: BotAction;
  message: string;
  mediaUrl: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  queueId: number | null;
  userId: number | null;
}

export interface BotState {
  nodeId: number | null;
  attempts: number;
}

export interface BotContext {
  nodes: BotNode[];
  defaultQueueId: number | null;
  isQueueOpen(queueId: number): boolean;
  messages: { transfer: string; outOfHours: string; invalid: string };
}

export type BotEffect =
  | { type: "send_text"; text: string }
  | { type: "send_media"; media: StoredMedia; caption: string }
  | { type: "transfer"; queueId: number | null; userId: number | null }
  | { type: "close" };

export interface StepResult {
  effects: BotEffect[];
  state: BotState;
  finished: boolean;
}

export const MAX_INVALID_ATTEMPTS = 3;
export const INVALID_OPTION_MESSAGE = "Opção inválida.";

export function renderMenu(node: BotNode, children: BotNode[]): string {
  const lines = children.map((c) => `${c.key} - ${c.title}`);
  if (node.parentId !== null) lines.push("0 - Voltar");
  return [node.message.trim(), lines.join("\n")].filter(Boolean).join("\n\n");
}

export const BOT_PATH_SEPARATOR = " › ";

/** Títulos das opções escolhidas até aqui (sem a mensagem inicial), ex.: "Suporte técnico › Sistema X". Null no início. */
export function botPath(nodes: BotNode[], state: BotState, input: string | null): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const current = state.nodeId !== null ? byId.get(state.nodeId) : undefined;
  if (!current) return null;
  const choice = input?.trim() ?? null;
  let target: BotNode | undefined = current;
  if (choice === "0" && current.parentId !== null) {
    target = byId.get(current.parentId);
  } else {
    const chosen = choice ? nodes.find((n) => n.parentId === current.id && n.key === choice) : undefined;
    if (chosen && chosen.action !== "reply") target = chosen;
  }
  const titles: string[] = [];
  for (let n = target; n && n.parentId !== null; n = byId.get(n.parentId)) titles.unshift(n.title);
  return titles.length > 0 ? titles.join(BOT_PATH_SEPARATOR) : null;
}

const sendText = (text: string): BotEffect => ({ type: "send_text", text });
const DONE: BotState = { nodeId: null, attempts: 0 };

export function step(state: BotState, input: string | null, ctx: BotContext): StepResult {
  const byId = new Map(ctx.nodes.map((n) => [n.id, n]));
  const childrenOf = (id: number) =>
    ctx.nodes.filter((n) => n.parentId === id).sort((a, b) => a.order - b.order || a.id - b.id);

  const transfer = (
    queueId: number | null,
    userId: number | null,
    nodeMessage: string,
    prefix: BotEffect[] = [],
  ): StepResult => {
    const targetQueue = queueId ?? (userId === null ? ctx.defaultQueueId : null);
    let message = nodeMessage || ctx.messages.transfer;
    if (targetQueue !== null && !ctx.isQueueOpen(targetQueue)) message = ctx.messages.outOfHours || message;
    const effects = [...prefix];
    if (message) effects.push(sendText(message));
    effects.push({ type: "transfer", queueId: targetQueue, userId });
    return { effects, state: DONE, finished: true };
  };

  const showMenu = (node: BotNode, prefix: BotEffect[] = [], attempts = 0): StepResult => {
    const children = childrenOf(node.id);
    if (node.parentId === null && children.length === 0) {
      return transfer(null, null, "", node.message ? [...prefix, sendText(node.message)] : prefix);
    }
    return { effects: [...prefix, sendText(renderMenu(node, children))], state: { nodeId: node.id, attempts }, finished: false };
  };

  const root = ctx.nodes.find((n) => n.parentId === null);
  if (!root) return transfer(null, null, "");

  const current = state.nodeId !== null ? byId.get(state.nodeId) : undefined;
  if (!current) return showMenu(root);

  const choice = input?.trim() ?? null;
  if (choice === "0" && current.parentId !== null) return showMenu(byId.get(current.parentId) ?? root);

  const chosen = choice ? childrenOf(current.id).find((c) => c.key === choice) : undefined;
  if (!chosen) {
    const attempts = state.attempts + 1;
    if (attempts >= MAX_INVALID_ATTEMPTS) return transfer(ctx.defaultQueueId, null, "");
    return showMenu(current, [sendText(ctx.messages.invalid)], attempts);
  }

  switch (chosen.action) {
    case "submenu":
      return showMenu(chosen);
    case "reply": {
      const prefix: BotEffect[] = chosen.mediaUrl
        ? [
            {
              type: "send_media",
              media: { url: chosen.mediaUrl, mime: chosen.mediaMime ?? "application/octet-stream", name: chosen.mediaName },
              caption: chosen.message,
            },
          ]
        : chosen.message
          ? [sendText(chosen.message)]
          : [];
      return showMenu(current, prefix);
    }
    case "transfer_queue":
      return transfer(chosen.queueId, null, chosen.message);
    case "transfer_agent":
      return transfer(chosen.queueId, chosen.userId, chosen.message);
    case "close":
      return {
        effects: [...(chosen.message ? [sendText(chosen.message)] : []), { type: "close" }],
        state: DONE,
        finished: true,
      };
  }
}
