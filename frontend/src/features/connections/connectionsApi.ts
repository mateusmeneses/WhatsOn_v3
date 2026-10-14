import { api } from "@/lib/api";
import type { Connection, ConnectionStatus } from "@/types/api";

export const connectionKeys = { all: ["connections"] as const };

export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "Conectado",
  qrcode: "Aguardando QR code",
  disconnected: "Desconectado",
};

export const DEFAULT_TRANSFER_MESSAGE = "Aguarde, em instantes um atendente irá falar com você.";
export const DEFAULT_OUT_OF_HOURS_MESSAGE =
  "Nosso horário de atendimento encerrou. Sua mensagem foi registrada e responderemos assim que possível.";

export interface ConnectionInput {
  name: string;
  isDefault?: boolean;
  defaultQueueId?: number | null;
  outOfHoursMessage?: string;
  closingMessage?: string;
  transferMessage?: string;
  botTimeoutMinutes?: number;
}

export async function fetchConnections(): Promise<Connection[]> {
  const { data } = await api.get<Connection[]>("/connections");
  return data;
}

export async function createConnection(input: ConnectionInput): Promise<Connection> {
  const { data } = await api.post<Connection>("/connections", input);
  return data;
}

export async function updateConnection(id: number, input: ConnectionInput): Promise<Connection> {
  const { data } = await api.put<Connection>(`/connections/${id}`, input);
  return data;
}

export async function deleteConnection(id: number): Promise<void> {
  await api.delete(`/connections/${id}`);
}

export async function fetchQrCode(id: number): Promise<{ qr: string | null }> {
  const { data } = await api.get<{ qr: string | null }>(`/connections/${id}/qrcode`);
  return data;
}

export async function disconnectConnection(id: number): Promise<Connection> {
  const { data } = await api.post<Connection>(`/connections/${id}/disconnect`);
  return data;
}
