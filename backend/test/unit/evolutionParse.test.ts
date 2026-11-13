import { parseEvolutionWebhook } from "../../src/modules/whatsapp/evolution/parseWebhook";
import { ackUpdate, connectionUpdate, imageMessage, qrcodeUpdate, textMessage, upsert } from "../fixtures/evolution";

describe("parseEvolutionWebhook", () => {
  it("parses a plain text message", () => {
    expect(parseEvolutionWebhook(textMessage({ timestamp: 1760000000 }))).toEqual([
      {
        kind: "message",
        instanceName: "inst_1",
        providerMessageId: "MSG1",
        remoteNumber: "5511988887777",
        isGroup: false,
        fromMe: false,
        pushName: "Maria",
        type: "text",
        body: "Oi",
        media: undefined,
        quotedProviderMessageId: undefined,
        timestamp: 1760000000,
      },
    ]);
  });

  it("parses extended text with a quoted message", () => {
    const [event] = parseEvolutionWebhook(
      upsert({
        key: { remoteJid: "5511988887777@s.whatsapp.net", fromMe: false, id: "M2" },
        message: { extendedTextMessage: { text: "isso aqui", contextInfo: { stanzaId: "M1" } } },
      }),
    );
    expect(event).toMatchObject({ kind: "message", type: "text", body: "isso aqui", quotedProviderMessageId: "M1" });
  });

  it("parses image with caption and media info", () => {
    const [event] = parseEvolutionWebhook(imageMessage());
    expect(event).toMatchObject({ type: "image", body: "comprovante", media: { mimetype: "image/jpeg" } });
  });

  it("parses documents (also wrapped with caption) using caption or file name as body", () => {
    const [plain] = parseEvolutionWebhook(
      upsert({
        key: { remoteJid: "5511988887777@s.whatsapp.net", fromMe: false, id: "D1" },
        message: { documentMessage: { fileName: "boleto.pdf", mimetype: "application/pdf" } },
      }),
    );
    expect(plain).toMatchObject({ type: "document", body: "boleto.pdf", media: { mimetype: "application/pdf", fileName: "boleto.pdf" } });

    const [wrapped] = parseEvolutionWebhook(
      upsert({
        key: { remoteJid: "5511988887777@s.whatsapp.net", fromMe: false, id: "D2" },
        message: {
          documentWithCaptionMessage: {
            message: { documentMessage: { fileName: "nf.pdf", caption: "segue a nota", mimetype: "application/pdf" } },
          },
        },
      }),
    );
    expect(wrapped).toMatchObject({ type: "document", body: "segue a nota" });
  });

  it("parses audio, sticker and location", () => {
    const base = { key: { remoteJid: "5511988887777@s.whatsapp.net", fromMe: false, id: "X" } };
    expect(parseEvolutionWebhook(upsert({ ...base, message: { audioMessage: { mimetype: "audio/ogg; codecs=opus" } } }))[0]).toMatchObject({ type: "audio", body: "" });
    expect(parseEvolutionWebhook(upsert({ ...base, message: { stickerMessage: { mimetype: "image/webp" } } }))[0]).toMatchObject({ type: "sticker" });
    expect(parseEvolutionWebhook(upsert({ ...base, message: { locationMessage: { degreesLatitude: -23.5, degreesLongitude: -46.6 } } }))[0]).toMatchObject({ type: "location", body: "-23.5,-46.6" });
  });

  it("flags group messages", () => {
    const [event] = parseEvolutionWebhook(
      upsert({ key: { remoteJid: "120363000000@g.us", fromMe: false, id: "G1" }, message: { conversation: "oi grupo" } }),
    );
    expect(event).toMatchObject({ isGroup: true });
  });

  it("carries the group participant as sender (real number when the participant is a LID)", () => {
    const [event] = parseEvolutionWebhook(
      upsert({
        key: { remoteJid: "120363000000@g.us", fromMe: false, id: "G2", participant: "5511955554444@s.whatsapp.net" },
        pushName: "João",
        message: { conversation: "bom dia" },
      }),
    );
    expect(event).toMatchObject({ remoteNumber: "120363000000", isGroup: true, senderNumber: "5511955554444", senderName: "João" });

    const [lid] = parseEvolutionWebhook(
      upsert({
        key: { remoteJid: "120363000000@g.us", fromMe: false, id: "G3", participant: "999@lid", participantAlt: "5511944443333@s.whatsapp.net" },
        message: { conversation: "oi" },
      }),
    );
    expect(lid).toMatchObject({ senderNumber: "5511944443333" });
  });

  it("parses shared contacts (vCard) into readable text", () => {
    const base = { key: { remoteJid: "5511988887777@s.whatsapp.net", fromMe: false, id: "C1" } };
    const vcard = "BEGIN:VCARD\nVERSION:3.0\nN:;Carlos;;;\nFN:Carlos Silva\nTEL;type=CELL;waid=5511912345678:+55 11 91234-5678\nEND:VCARD";
    const [single] = parseEvolutionWebhook(upsert({ ...base, message: { contactMessage: { displayName: "Carlos Silva", vcard } } }));
    expect(single).toMatchObject({ type: "text", body: "👤 Contato: Carlos Silva\n📞 +55 11 91234-5678" });

    const [many] = parseEvolutionWebhook(
      upsert({
        ...base,
        message: {
          contactsArrayMessage: {
            contacts: [
              { displayName: "Ana", vcard: "BEGIN:VCARD\nFN:Ana\nTEL:+5511900000001\nEND:VCARD" },
              { displayName: "Bia", vcard: "BEGIN:VCARD\nFN:Bia\nEND:VCARD" },
            ],
          },
        },
      }),
    );
    expect(many).toMatchObject({ type: "text", body: "👤 Contato: Ana\n📞 +5511900000001\n\n👤 Contato: Bia" });
  });

  it("parses polls, button/list replies and live location", () => {
    const base = { key: { remoteJid: "5511988887777@s.whatsapp.net", fromMe: false, id: "P1" } };
    const parse = (message: object) => parseEvolutionWebhook(upsert({ ...base, message }))[0];
    expect(parse({ pollCreationMessageV3: { name: "Melhor dia?", options: [{ optionName: "Seg" }, { optionName: "Ter" }] } })).toMatchObject({
      type: "text",
      body: "📊 Enquete: Melhor dia?\n• Seg\n• Ter",
    });
    expect(parse({ buttonsResponseMessage: { selectedDisplayText: "Sim" } })).toMatchObject({ type: "text", body: "Sim" });
    expect(parse({ listResponseMessage: { title: "Suporte" } })).toMatchObject({ type: "text", body: "Suporte" });
    expect(parse({ templateButtonReplyMessage: { selectedDisplayText: "Ok" } })).toMatchObject({ type: "text", body: "Ok" });
    expect(parse({ liveLocationMessage: { degreesLatitude: 1, degreesLongitude: 2 } })).toMatchObject({ type: "location", body: "1,2" });
  });

  it("never drops an unknown message type: stores a placeholder text", () => {
    const [event] = parseEvolutionWebhook(
      upsert({ key: { remoteJid: "5511988887777@s.whatsapp.net", fromMe: false, id: "U1" }, message: { eventMessage: { name: "x" }, messageContextInfo: {} } }),
    );
    expect(event).toMatchObject({ type: "text", body: "[Mensagem não suportada pelo WhatsOn — veja no celular]" });
  });

  it("uses the real phone number for @lid contacts when available", () => {
    const [withAlt] = parseEvolutionWebhook(
      upsert({
        key: { remoteJid: "123456789012345@lid", remoteJidAlt: "5511977776666@s.whatsapp.net", fromMe: false, id: "L1" },
        message: { conversation: "oi" },
      }),
    );
    expect(withAlt).toMatchObject({ remoteNumber: "5511977776666", isGroup: false });

    const [withSenderPn] = parseEvolutionWebhook(
      upsert({
        key: { remoteJid: "123456789012345@lid", senderPn: "5511966665555@s.whatsapp.net", fromMe: false, id: "L2" },
        message: { conversation: "oi" },
      }),
    );
    expect(withSenderPn).toMatchObject({ remoteNumber: "5511966665555" });
  });

  it("keeps the LID user part when no real number is available", () => {
    const [event] = parseEvolutionWebhook(
      upsert({ key: { remoteJid: "123456789012345@lid", fromMe: false, id: "L3" }, message: { conversation: "oi" } }),
    );
    expect(event).toMatchObject({ remoteNumber: "123456789012345", isGroup: false });
  });

  it("falls back to now when messageTimestamp is a Long-like object", () => {
    const [event] = parseEvolutionWebhook(
      upsert({
        key: { remoteJid: "5511988887777@s.whatsapp.net", fromMe: false, id: "T1" },
        message: { conversation: "oi" },
        messageTimestamp: { low: 1, high: 0 },
      }),
    );
    expect(Number.isFinite((event as { timestamp: number }).timestamp)).toBe(true);
  });

  it("ignores reactions, protocol messages, status broadcasts and garbage", () => {
    const key = { remoteJid: "5511988887777@s.whatsapp.net", fromMe: false, id: "R1" };
    expect(parseEvolutionWebhook(upsert({ key, message: { reactionMessage: { text: "👍" } } }))).toEqual([]);
    expect(parseEvolutionWebhook(upsert({ key, message: { protocolMessage: {} } }))).toEqual([]);
    expect(parseEvolutionWebhook(upsert({ key, message: { senderKeyDistributionMessage: {}, messageContextInfo: {} } }))).toEqual([]);
    expect(parseEvolutionWebhook(upsert({ key, message: { pollUpdateMessage: {} } }))).toEqual([]);
    expect(parseEvolutionWebhook(upsert({ key: { ...key, remoteJid: "status@broadcast" }, message: { conversation: "x" } }))).toEqual([]);
    expect(parseEvolutionWebhook(null)).toEqual([]);
    expect(parseEvolutionWebhook({ event: "chats.update", data: {} })).toEqual([]);
  });

  it("accepts uppercase event names", () => {
    const payload = { ...textMessage(), event: "MESSAGES_UPSERT" };
    expect(parseEvolutionWebhook(payload)).toHaveLength(1);
  });

  it("maps ack statuses", () => {
    expect(parseEvolutionWebhook(ackUpdate("M1", "SERVER_ACK"))).toEqual([
      { kind: "ack", instanceName: "inst_1", providerMessageId: "M1", remoteNumber: "5511988887777", ack: "sent" },
    ]);
    expect(parseEvolutionWebhook(ackUpdate("M1", "DELIVERY_ACK"))[0]).toMatchObject({ ack: "delivered" });
    expect(parseEvolutionWebhook(ackUpdate("M1", "READ"))[0]).toMatchObject({ ack: "read" });
    expect(parseEvolutionWebhook(ackUpdate("M1", "PLAYED"))[0]).toMatchObject({ ack: "read" });
    expect(parseEvolutionWebhook(ackUpdate("M1", "ERROR"))[0]).toMatchObject({ ack: "failed" });
    expect(parseEvolutionWebhook(ackUpdate("M1", "WHATEVER"))).toEqual([]);
  });

  it("maps connection states and QR codes", () => {
    expect(parseEvolutionWebhook(connectionUpdate("open"))).toEqual([
      { kind: "connection", instanceName: "inst_1", state: "connected", number: "5511999990000" },
    ]);
    expect(parseEvolutionWebhook(connectionUpdate("connecting"))[0]).toMatchObject({ state: "qrcode" });
    expect(parseEvolutionWebhook(connectionUpdate("close"))[0]).toMatchObject({ state: "disconnected" });
    expect(parseEvolutionWebhook(qrcodeUpdate())).toEqual([
      { kind: "qrcode", instanceName: "inst_1", qrBase64: "data:image/png;base64,QRDATA" },
    ]);
  });
});
