import axios, { AxiosInstance, AxiosResponse } from "axios";
import { env } from "../../../config/env";
import { ConnectionStatus } from "../../../models";
import { AppError } from "../../../shared/errors/AppError";
import { logger } from "../../../shared/logger";
import { InboundEvent, OutboundMedia, SendResult, WhatsAppProvider } from "../provider";
import { EVOLUTION_STATES, parseEvolutionWebhook } from "./parseWebhook";

const WEBHOOK_EVENTS = ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"];

export class EvolutionProvider implements WhatsAppProvider {
  private readonly http: AxiosInstance;

  constructor(baseURL = env.EVOLUTION_URL, apiKey = env.EVOLUTION_API_KEY) {
    this.http = axios.create({ baseURL, headers: { apikey: apiKey }, timeout: 30_000 });
  }

  private async call<T>(request: () => Promise<AxiosResponse<T>>, allow404 = false): Promise<T | null> {
    try {
      return (await request()).data;
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (allow404 && status === 404) return null;
      logger.warn({ err: axios.isAxiosError(err) ? err.message : err, status }, "evolution request failed");
      throw new AppError("PROVIDER_ERROR", 502, `Falha na Evolution API${status ? ` (${status})` : ""}`);
    }
  }

  private sentId(data: { key?: { id?: string } } | null): SendResult {
    const id = data?.key?.id;
    if (!id) throw new AppError("PROVIDER_ERROR", 502, "Evolution API não retornou o id da mensagem");
    return { providerMessageId: id };
  }

  async ping(): Promise<void> {
    await this.call(() => this.http.get("/"));
  }

  async createInstance(instanceName: string, webhookUrl: string): Promise<void> {
    await this.call(() =>
      this.http.post("/instance/create", {
        instanceName,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        groupsIgnore: true,
        webhook: { url: webhookUrl, byEvents: false, base64: false, events: WEBHOOK_EVENTS },
      }),
    );
  }

  async deleteInstance(instanceName: string): Promise<void> {
    await this.call(() => this.http.delete(`/instance/delete/${instanceName}`), true);
  }

  async logout(instanceName: string): Promise<void> {
    await this.call(() => this.http.delete(`/instance/logout/${instanceName}`), true);
  }

  async getQrCode(instanceName: string): Promise<string | null> {
    const data = await this.call<{ base64?: string }>(() => this.http.get(`/instance/connect/${instanceName}`));
    return data?.base64 ?? null;
  }

  async getConnectionState(instanceName: string): Promise<ConnectionStatus> {
    const data = await this.call<{ instance?: { state?: string } }>(
      () => this.http.get(`/instance/connectionState/${instanceName}`),
      true,
    );
    return EVOLUTION_STATES[data?.instance?.state ?? ""] ?? "disconnected";
  }

  async sendText(instanceName: string, number: string, text: string, quotedProviderMessageId?: string): Promise<SendResult> {
    const body = {
      number,
      text,
      ...(quotedProviderMessageId ? { quoted: { key: { id: quotedProviderMessageId } } } : {}),
    };
    return this.sentId(await this.call(() => this.http.post(`/message/sendText/${instanceName}`, body)));
  }

  async sendMedia(instanceName: string, number: string, media: OutboundMedia): Promise<SendResult> {
    if (media.type === "audio") {
      return this.sentId(
        await this.call(() => this.http.post(`/message/sendWhatsAppAudio/${instanceName}`, { number, audio: media.base64 })),
      );
    }
    const body = {
      number,
      mediatype: media.type,
      mimetype: media.mimetype,
      media: media.base64,
      ...(media.fileName ? { fileName: media.fileName } : {}),
      ...(media.caption ? { caption: media.caption } : {}),
    };
    return this.sentId(await this.call(() => this.http.post(`/message/sendMedia/${instanceName}`, body)));
  }

  async downloadMedia(instanceName: string, providerMessageId: string): Promise<{ base64: string; mimetype: string }> {
    const data = await this.call<{ base64?: string; mimetype?: string }>(() =>
      this.http.post(`/chat/getBase64FromMediaMessage/${instanceName}`, {
        message: { key: { id: providerMessageId } },
        convertToMp4: false,
      }),
    );
    if (!data?.base64) throw new AppError("PROVIDER_ERROR", 502, "Mídia indisponível na Evolution API");
    return { base64: data.base64, mimetype: data.mimetype ?? "application/octet-stream" };
  }

  parseWebhook(payload: unknown): InboundEvent[] {
    return parseEvolutionWebhook(payload);
  }
}
