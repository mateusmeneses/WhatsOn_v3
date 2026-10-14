import { api } from "@/lib/api";
import type { BotAction, BotState, ChatbotNode, StepResult } from "@/types/api";

export const chatbotKeys = {
  nodes: (connectionId: number) => ["chatbot", connectionId] as const,
};

export interface NodeInput {
  parentId?: number | null;
  key?: string;
  title?: string;
  action?: BotAction;
  message?: string;
  mediaUrl?: string | null;
  mediaMime?: string | null;
  mediaName?: string | null;
  queueId?: number | null;
  userId?: number | null;
}

export async function fetchNodes(connectionId: number): Promise<ChatbotNode[]> {
  const { data } = await api.get<ChatbotNode[]>(`/connections/${connectionId}/chatbot`);
  return data;
}

export async function createNode(connectionId: number, input: NodeInput): Promise<ChatbotNode> {
  const { data } = await api.post<ChatbotNode>(`/connections/${connectionId}/chatbot/nodes`, input);
  return data;
}

export async function updateNode(id: number, input: NodeInput): Promise<ChatbotNode> {
  const { data } = await api.put<ChatbotNode>(`/chatbot/nodes/${id}`, input);
  return data;
}

export async function deleteNode(id: number): Promise<void> {
  await api.delete(`/chatbot/nodes/${id}`);
}

export async function reorderChildren(parentId: number, ids: number[]): Promise<ChatbotNode[]> {
  const { data } = await api.put<ChatbotNode[]>(`/chatbot/nodes/${parentId}/children-order`, { ids });
  return data;
}

export async function simulate(connectionId: number, state: BotState, input: string | null): Promise<StepResult> {
  const { data } = await api.post<StepResult>(`/connections/${connectionId}/chatbot/simulate`, { state, input });
  return data;
}
