import { ConnectionStatus } from "../../src/models";
import { parseEvolutionWebhook } from "../../src/modules/whatsapp/evolution/parseWebhook";
import { InboundEvent, NumberCheck, OutboundMedia, SendResult, WhatsAppProvider } from "../../src/modules/whatsapp/provider";
import { AppError } from "../../src/shared/errors/AppError";

type Method = "createInstance" | "deleteInstance" | "logout" | "getQrCode" | "send" | "edit" | "delete" | "downloadMedia" | "checkNumber";

export interface SentItem {
  instanceName: string;
  number: string;
  text?: string;
  quoted?: string;
  media?: OutboundMedia;
}

export class FakeProvider implements WhatsAppProvider {
  sent: SentItem[] = [];
  edits: { number: string; id: string; text: string }[] = [];
  deletes: { number: string; id: string }[] = [];
  instances = new Map<string, string>();
  /** Instâncias que o provedor "perdeu": getQrCode falha com INSTANCE_NOT_FOUND até serem recriadas. */
  lostInstances = new Set<string>();
  state: ConnectionStatus = "connected";
  /** Números que o checkNumber responde como inexistentes no WhatsApp. */
  missingNumbers = new Set<string>();
  /** Número consultado -> jid devolvido (ex.: sem o nono dígito). */
  jidOverrides = new Map<string, string>();
  private failures = new Map<Method, number>();
  private counter = 0;

  reset(): void {
    this.sent = [];
    this.edits = [];
    this.deletes = [];
    this.instances.clear();
    this.lostInstances.clear();
    this.state = "connected";
    this.missingNumbers.clear();
    this.jidOverrides.clear();
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
    this.lostInstances.delete(instanceName);
  }

  async deleteInstance(instanceName: string): Promise<void> {
    this.maybeFail("deleteInstance");
    this.instances.delete(instanceName);
  }

  async logout(): Promise<void> {
    this.maybeFail("logout");
  }

  async getQrCode(instanceName: string): Promise<string | null> {
    this.maybeFail("getQrCode");
    if (this.lostInstances.has(instanceName)) throw new AppError("INSTANCE_NOT_FOUND", 404, "fake instance not found");
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

  async editText(_instanceName: string, number: string, id: string, text: string): Promise<void> {
    this.maybeFail("edit");
    this.edits.push({ number, id, text });
  }

  async deleteForEveryone(_instanceName: string, number: string, id: string): Promise<void> {
    this.maybeFail("delete");
    this.deletes.push({ number, id });
  }

  async checkNumber(_instanceName: string, number: string): Promise<NumberCheck> {
    this.maybeFail("checkNumber");
    if (this.missingNumbers.has(number)) return { exists: false, jid: null };
    return { exists: true, jid: this.jidOverrides.get(number) ?? `${number}@s.whatsapp.net` };
  }

  async downloadMedia(): Promise<{ base64: string; mimetype: string }> {
    this.maybeFail("downloadMedia");
    return { base64: Buffer.from("fake-media").toString("base64"), mimetype: "image/jpeg" };
  }

  parseWebhook(payload: unknown): InboundEvent[] {
    return parseEvolutionWebhook(payload);
  }
}
