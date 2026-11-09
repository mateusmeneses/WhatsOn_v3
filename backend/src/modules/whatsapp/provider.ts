import { Ack, ConnectionStatus, MessageType } from "../../models";

export interface InboundMessage {
  kind: "message";
  instanceName: string;
  providerMessageId: string;
  remoteNumber: string;
  isGroup: boolean;
  fromMe: boolean;
  pushName?: string;
  /** Só em grupo: número e nome de quem mandou. */
  senderNumber?: string;
  senderName?: string;
  type: MessageType;
  body: string;
  media?: { mimetype: string; fileName?: string };
  quotedProviderMessageId?: string;
  timestamp: number;
}
export interface AckUpdate { kind: "ack"; instanceName: string; providerMessageId: string; remoteNumber: string | null; ack: Ack }
export interface ConnectionUpdate { kind: "connection"; instanceName: string; state: ConnectionStatus; number?: string }
export interface QrCodeUpdate { kind: "qrcode"; instanceName: string; qrBase64: string }
export type InboundEvent = InboundMessage | AckUpdate | ConnectionUpdate | QrCodeUpdate;
export type OutboundMediaType = "image" | "audio" | "video" | "document";
export interface OutboundMedia { type: OutboundMediaType; base64: string; mimetype: string; fileName?: string; caption?: string }
export interface SendResult { providerMessageId: string }
export interface NumberCheck { exists: boolean; jid: string | null }
/** Destino no WhatsApp: grupo vai com o JID completo; contato, só com o número. */
export function waAddress(contact: { number: string; isGroup: boolean }): string {
  return contact.isGroup ? `${contact.number}@g.us` : contact.number;
}

export interface WhatsAppProvider {
  ping(): Promise<void>;
  createInstance(instanceName: string, webhookUrl: string): Promise<void>;
  deleteInstance(instanceName: string): Promise<void>;
  logout(instanceName: string): Promise<void>;
  getQrCode(instanceName: string): Promise<string | null>;
  getConnectionState(instanceName: string): Promise<ConnectionStatus>;
  sendText(instanceName: string, number: string, text: string, quotedProviderMessageId?: string): Promise<SendResult>;
  sendMedia(instanceName: string, number: string, media: OutboundMedia): Promise<SendResult>;
  editText(instanceName: string, number: string, providerMessageId: string, text: string): Promise<void>;
  deleteForEveryone(instanceName: string, number: string, providerMessageId: string): Promise<void>;
  checkNumber(instanceName: string, number: string): Promise<NumberCheck>;
  /** Nome (assunto) do grupo; null se não der para descobrir. */
  getGroupSubject(instanceName: string, groupId: string): Promise<string | null>;
  /** Garante que a instância recebe mensagens de grupo. true = precisou mudar. */
  enableGroups(instanceName: string): Promise<boolean>;
  downloadMedia(instanceName: string, providerMessageId: string): Promise<{ base64: string; mimetype: string }>;
  parseWebhook(payload: unknown): InboundEvent[];
}
