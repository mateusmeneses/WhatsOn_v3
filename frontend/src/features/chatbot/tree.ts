import type { BotAction, ChatbotNode } from "@/types/api";

export interface TreeNode {
  node: ChatbotNode;
  children: TreeNode[];
}

export const ACTION_LABELS: Record<BotAction, string> = {
  submenu: "Submenu",
  reply: "Responder",
  transfer_queue: "Transferir para fila",
  transfer_agent: "Transferir para atendente",
  close: "Encerrar conversa",
};

const byOrder = (a: ChatbotNode, b: ChatbotNode) => a.order - b.order || a.id - b.id;

export function buildTree(nodes: ChatbotNode[]): TreeNode | null {
  const byParent = new Map<number | null, ChatbotNode[]>();
  for (const n of nodes) {
    const list = byParent.get(n.parentId) ?? [];
    list.push(n);
    byParent.set(n.parentId, list);
  }
  const make = (n: ChatbotNode): TreeNode => ({
    node: n,
    children: [...(byParent.get(n.id) ?? [])].sort(byOrder).map(make),
  });
  const root = byParent.get(null)?.[0];
  return root ? make(root) : null;
}

export function moveId(ids: number[], activeId: number, overId: number): number[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

export function moveByOffset(ids: number[], id: number, offset: -1 | 1): number[] {
  const index = ids.indexOf(id);
  const target = ids[index + offset];
  return index < 0 || target === undefined ? ids : moveId(ids, id, target);
}

export function nextFreeKey(siblings: ChatbotNode[]): string {
  for (let key = 1; key <= 99; key++) {
    if (!siblings.some((s) => s.key === String(key))) return String(key);
  }
  return "";
}

export function canHaveChildren(node: ChatbotNode): boolean {
  return node.parentId === null || node.action === "submenu";
}
