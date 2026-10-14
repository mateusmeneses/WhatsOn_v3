import { ConnectionStatus } from "../../src/models";
import { parseEvolutionWebhook } from "../../src/modules/whatsapp/evolution/parseWebhook";
import { InboundEvent, OutboundMedia, SendResult, WhatsAppProvider } from "../../src/modules/whatsapp/provider";
import { AppError } from "../../src/shared/errors/AppError";

type Method = "createInstance" | "deleteInstance" | "logout" | "getQrCode" | "send" | "downloadMedia";

export interface SentItem {
  instanceName: string;
  number: string;
  text?: string;
  quoted?: string;
  media?: OutboundMedia;
}

export class FakeProvider implements WhatsAppProvider {
  sent: SentItem[] = [];
  instances = new Map<string, string>();
  state: ConnectionStatus = "connected";
  private failures = new Map<Method, number>();
  private counter = 0;

  reset(): void {
    this.sent = [];
    this.instances.clear();
    this.state = "connected";
    this.failures.clear();
    this.counter = 0;
  }

  failNext(method: Method, times = 1): void {
    this.failures.set(method, times);
  }

  texts(): string[] {
    return this.sent.flatMap((s) => (s.text !== undefined ? [s.text] : []));
  }

  private maybeFail(method: Method): void {
    const left = this.failures.get(method) ?? 0;
    if (left > 0) {
      this.failures.set(method, left - 1);
      throw new AppError("PROVIDER_ERROR", 502, `fake ${method} failure`);
    }
  }

  async ping(): Promise<void> {}

  async createInstance(instanceName: string, webhookUrl: string): Promise<void> {
    this.maybeFail("createInstance");
    this.instances.set(instanceName, webhookUrl);
  }

  async deleteInstance(instanceName: string): Promise<void> {
    this.maybeFail("deleteInstance");
    this.instances.delete(instanceName);
  }

  async logout(): Promise<void> {
    this.maybeFail("logout");
  }

  async getQrCode(): Promise<string | null> {
    this.maybeFail("getQrCode");
    return "data:image/png;base64,FAKEQR";
  }

  async getConnectionState(): Promise<ConnectionStatus> {
    return this.state;
  }

  async sendText(instanceName: string, number: string, text: string, quoted?: string): Promise<SendResult> {
    this.maybeFail("send");
    this.sent.push({ instanceName, number, text, quoted });
    return { providerMessageId: `fake-${++this.counter}` };
  }

  async sendMedia(instanceName: string, number: string, media: OutboundMedia): Promise<SendResult> {
    this.maybeFail("send");
    this.sent.push({ instanceName, number, media });
    return { providerMessageId: `fake-${++this.counter}` };
  }

  async downloadMedia(): Promise<{ base64: string; mimetype: string }> {
    this.maybeFail("downloadMedia");
    return { base64: Buffer.from("fake-media").toString("base64"), mimetype: "image/jpeg" };
  }

  parseWebhook(payload: unknown): InboundEvent[] {
    return parseEvolutionWebhook(payload);
  }
}
