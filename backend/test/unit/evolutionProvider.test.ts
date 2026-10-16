import nock from "nock";
import { EvolutionProvider } from "../../src/modules/whatsapp/evolution/EvolutionProvider";
import { logger } from "../../src/shared/logger";

const BASE = "http://evolution.test";
const provider = new EvolutionProvider(BASE, "key-123");
const api = () => nock(BASE, { reqheaders: { apikey: "key-123" } });

describe("EvolutionProvider", () => {
  beforeAll(() => nock.disableNetConnect());
  afterEach(() => nock.cleanAll());
  afterAll(() => nock.enableNetConnect());

  it("creates an instance with the webhook configured without base64", async () => {
    const scope = api()
      .post("/instance/create", (body) =>
        body.instanceName === "wo_1_ab" &&
        body.integration === "WHATSAPP-BAILEYS" &&
        body.qrcode === true &&
        body.groupsIgnore === true &&
        body.webhook.url === "http://hook" &&
        body.webhook.base64 === false &&
        body.webhook.byEvents === false &&
        ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"].every((e) => body.webhook.events.includes(e)),
      )
      .reply(201, { instance: { instanceName: "wo_1_ab" } });
    await provider.createInstance("wo_1_ab", "http://hook");
    expect(scope.isDone()).toBe(true);
  });

  it("sends text and returns the WhatsApp message id", async () => {
    api().post("/message/sendText/inst", { number: "5511988887777", text: "olá" }).reply(201, { key: { id: "SENT1" } });
    await expect(provider.sendText("inst", "5511988887777", "olá")).resolves.toEqual({ providerMessageId: "SENT1" });
  });

  it("edits a sent text message", async () => {
    const scope = api()
      .post("/chat/updateMessage/inst", {
        number: "5511988887777",
        key: { remoteJid: "5511988887777@s.whatsapp.net", fromMe: true, id: "M1" },
        text: "corrigido",
      })
      .reply(200, {});
    await provider.editText("inst", "5511988887777", "M1", "corrigido");
    expect(scope.isDone()).toBe(true);
  });

  it("deletes a message for everyone", async () => {
    const scope = api()
      .delete("/chat/deleteMessageForEveryone/inst", { id: "M1", remoteJid: "5511988887777@s.whatsapp.net", fromMe: true })
      .reply(200, {});
    await provider.deleteForEveryone("inst", "5511988887777", "M1");
    expect(scope.isDone()).toBe(true);
  });

  it("sends quoted text", async () => {
    api()
      .post("/message/sendText/inst", { number: "5511988887777", text: "sim", quoted: { key: { id: "Q1" } } })
      .reply(201, { key: { id: "SENT2" } });
    await expect(provider.sendText("inst", "5511988887777", "sim", "Q1")).resolves.toEqual({ providerMessageId: "SENT2" });
  });

  it("sends audio as a WhatsApp voice note", async () => {
    api().post("/message/sendWhatsAppAudio/inst", { number: "5511988887777", audio: "QVVE" }).reply(201, { key: { id: "AUD1" } });
    const result = await provider.sendMedia("inst", "5511988887777", { type: "audio", base64: "QVVE", mimetype: "audio/ogg" });
    expect(result.providerMessageId).toBe("AUD1");
  });

  it("sends documents through sendMedia", async () => {
    api()
      .post("/message/sendMedia/inst", {
        number: "5511988887777",
        mediatype: "document",
        mimetype: "application/pdf",
        media: "UERG",
        fileName: "a.pdf",
        caption: "segue",
      })
      .reply(201, { key: { id: "DOC1" } });
    const result = await provider.sendMedia("inst", "5511988887777", {
      type: "document",
      base64: "UERG",
      mimetype: "application/pdf",
      fileName: "a.pdf",
      caption: "segue",
    });
    expect(result.providerMessageId).toBe("DOC1");
  });

  it("maps connection state", async () => {
    api().get("/instance/connectionState/inst").reply(200, { instance: { instanceName: "inst", state: "open" } });
    await expect(provider.getConnectionState("inst")).resolves.toBe("connected");
    api().get("/instance/connectionState/inst").reply(200, { instance: { state: "connecting" } });
    await expect(provider.getConnectionState("inst")).resolves.toBe("qrcode");
    api().get("/instance/connectionState/inst").reply(200, { instance: { state: "close" } });
    await expect(provider.getConnectionState("inst")).resolves.toBe("disconnected");
  });

  it("returns the QR code base64", async () => {
    api().get("/instance/connect/inst").reply(200, { base64: "data:image/png;base64,AAA", code: "2@x" });
    await expect(provider.getQrCode("inst")).resolves.toBe("data:image/png;base64,AAA");
  });

  it("reports a missing instance on QR code as INSTANCE_NOT_FOUND", async () => {
    api().get("/instance/connect/gone").reply(404, { status: 404, response: { message: ['The "gone" instance does not exist'] } });
    await expect(provider.getQrCode("gone")).rejects.toMatchObject({ code: "INSTANCE_NOT_FOUND" });
  });

  it("downloads media by message id", async () => {
    api()
      .post("/chat/getBase64FromMediaMessage/inst", { message: { key: { id: "M1" } }, convertToMp4: false })
      .reply(201, { base64: "QUJD", mimetype: "image/jpeg" });
    await expect(provider.downloadMedia("inst", "M1")).resolves.toEqual({ base64: "QUJD", mimetype: "image/jpeg" });
  });

  it("tolerates 404 when deleting or logging out an instance", async () => {
    api().delete("/instance/logout/inst").reply(404, {});
    api().delete("/instance/delete/inst").reply(404, {});
    await expect(provider.logout("inst")).resolves.toBeUndefined();
    await expect(provider.deleteInstance("inst")).resolves.toBeUndefined();
  });

  it("wraps failures in a PROVIDER_ERROR AppError", async () => {
    api().post("/message/sendText/inst").reply(500, { error: "boom" });
    await expect(provider.sendText("inst", "5511988887777", "x")).rejects.toMatchObject({ code: "PROVIDER_ERROR", status: 502 });
  });

  it("logs the response body (truncated) and request path, never the apikey", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    try {
      api().post("/message/sendText/inst").reply(400, { response: { message: ["número inexistente"] }, pad: "x".repeat(1000) });
      await expect(provider.sendText("inst", "5511988887777", "x")).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
      expect(warn).toHaveBeenCalledTimes(1);
      const [fields] = warn.mock.calls[0] as unknown as [Record<string, unknown>];
      expect(fields).toMatchObject({ status: 400, method: "POST", path: "/message/sendText/inst" });
      expect(fields.response).toContain("número inexistente");
      expect((fields.response as string).length).toBeLessThanOrEqual(501);
      expect(JSON.stringify(fields)).not.toContain("key-123");
    } finally {
      warn.mockRestore();
    }
  });

  it("pings the API root", async () => {
    api().get("/").reply(200, { status: 200 });
    await expect(provider.ping()).resolves.toBeUndefined();
  });
});
