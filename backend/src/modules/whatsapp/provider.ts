import { Ack, ConnectionStatus, MessageType } from "../../models";

export interface InboundMessage {
  kind: "message";
  instanceName: string;
  providerMessageId: string;
  remoteNumber: string;
  isGroup: boolean;
  fromMe: boolean;
  pushName?: string;
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
export interface WhatsAppProvider {
  ping(): Promise<void>;
  createInstance(instanceName: string, webhookUrl: string): Promise<void>;
  deleteInstance(instanceName: string): Promise<void>;
  logout(instanceName: string): Promise<void>;
  getQrCode(instanceName: string): Promise<string | null>;
  getConnectionState(instanceName: string): Promise<ConnectionStatus>;
  sendText(instanceName: string, number: string, text: string, quotedProviderMessageId?: string): Promise<SendResult>;
  sendMedia(instanceName: string, number: string, media: OutboundMedia): Promise<SendResult>;
  downloadMedia(instanceName: string, providerMessageId: string): Promise<{ base64: string; mimetype: string }>;
  parseWebhook(payload: unknown): InboundEvent[];
}
