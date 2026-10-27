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
  /** Opção do menu atual com o produto do contato, aguardando o "Sim" (só presente durante a pergunta). */
  confirmId?: number | null;
}

export interface BotContext {
  nodes: BotNode[];
  defaultQueueId: number | null;
  isQueueOpen(queueId: number): boolean;
  messages: { transfer: string; outOfHours: string; invalid: string };
  /** Produto cadastrado no contato: o bot pergunta se o atendimento é sobre ele quando o menu o lista. */
  contactProduct?: string | null;
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

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Opção do menu com o mesmo nome do produto do contato (sem diferenciar maiúsculas e acentos). */
export function productOption(children: BotNode[], product: string | null | undefined): BotNode | undefined {
  const wanted = product ? normalize(product) : "";
  return wanted ? children.find((c) => normalize(c.title) === wanted) : undefined;
}

export const confirmProductMessage = (title: string): string =>
  `Seu atendimento é sobre o *${title}*?\n\n1 - Sim\n2 - Não, outro sistema`;

/** Títulos das opções escolhidas até aqui (sem a mensagem inicial), ex.: "Suporte técnico › Sistema X". Null no início. */
export function botPath(nodes: BotNode[], state: BotState, input: string | null): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const current = state.nodeId !== null ? byId.get(state.nodeId) : undefined;
  if (!current) return null;
  const choice = input?.trim() ?? null;
  let target: BotNode | undefined = current;
  const confirming = state.confirmId != null ? byId.get(state.confirmId) : undefined;
  if (confirming) {
    if (choice === "1" && confirming.action !== "reply") target = confirming;
  } else if (choice === "0" && current.parentId !== null) {
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

  // Ao entrar num menu que lista o produto do contato, pergunta antes se é sobre ele.
  const enterMenu = (node: BotNode): StepResult => {
    const option = productOption(childrenOf(node.id), ctx.contactProduct);
    if (!option) return showMenu(node);
    return {
      effects: [sendText(confirmProductMessage(option.title))],
      state: { nodeId: node.id, attempts: 0, confirmId: option.id },
      finished: false,
    };
  };

  const choose = (current: BotNode, chosen: BotNode): StepResult => {
    switch (chosen.action) {
      case "submenu":
        return enterMenu(chosen);
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
  };

  const root = ctx.nodes.find((n) => n.parentId === null);
  if (!root) return transfer(null, null, "");

  const current = state.nodeId !== null ? byId.get(state.nodeId) : undefined;
  if (!current) return enterMenu(root);

  const choice = input?.trim() ?? null;
  const confirming = state.confirmId != null ? byId.get(state.confirmId) : undefined;
  if (confirming && confirming.parentId === current.id) {
    if (choice === "1") return choose(current, confirming);
    if (choice === "2") return showMenu(current);
    const attempts = state.attempts + 1;
    if (attempts >= MAX_INVALID_ATTEMPTS) return transfer(ctx.defaultQueueId, null, "");
    return {
      effects: [sendText(ctx.messages.invalid), sendText(confirmProductMessage(confirming.title))],
      state: { nodeId: current.id, attempts, confirmId: confirming.id },
      finished: false,
    };
  }

  if (choice === "0" && current.parentId !== null) return showMenu(byId.get(current.parentId) ?? root);

  const chosen = choice ? childrenOf(current.id).find((c) => c.key === choice) : undefined;
  if (!chosen) {
    const attempts = state.attempts + 1;
    if (attempts >= MAX_INVALID_ATTEMPTS) return transfer(ctx.defaultQueueId, null, "");
    return showMenu(current, [sendText(ctx.messages.invalid)], attempts);
  }

  return choose(current, chosen);
}
