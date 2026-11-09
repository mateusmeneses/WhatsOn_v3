import { Ack, ConnectionStatus, MessageType } from "../../../models";
import { AckUpdate, InboundEvent, InboundMessage } from "../provider";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const ACKS: Record<string, Ack> = {
  PENDING: "pending",
  SERVER_ACK: "sent",
  DELIVERY_ACK: "delivered",
  READ: "read",
  PLAYED: "read",
  ERROR: "failed",
};

export const EVOLUTION_STATES: Record<string, ConnectionStatus> = { open: "connected", connecting: "qrcode", close: "disconnected" };

const jidUser = (jid: string) => jid.split("@")[0].split(":")[0];

function resolveRemote(key: Json): { number: string; isGroup: boolean } | null {
  const jid: unknown = key?.remoteJid;
  if (typeof jid !== "string" || !jid) return null;
  if (jid.endsWith("@broadcast")) return null;
  if (jid.endsWith("@g.us")) return { number: jidUser(jid), isGroup: true };
  if (jid.endsWith("@lid")) {
    const alt = key.remoteJidAlt ?? key.senderPn;
    return { number: jidUser(typeof alt === "string" && alt ? alt : jid), isGroup: false };
  }
  return { number: jidUser(jid), isGroup: false };
}

/** Quem falou no grupo: o participante, preferindo o número real quando ele vem como LID. */
function groupSender(key: Json): string | undefined {
  const p: unknown = key?.participant;
  const alt: unknown = key?.participantAlt ?? key?.participantPn;
  const jid = typeof p === "string" && p.endsWith("@lid") && typeof alt === "string" && alt ? alt : p;
  return typeof jid === "string" && jid ? jidUser(jid) : undefined;
}

interface Content {
  type: MessageType;
  body: string;
  media?: { mimetype: string; fileName?: string };
  quotedId?: string;
}

function mediaContent(type: MessageType, node: Json, body: string): Content {
  return {
    type,
    body,
    media: { mimetype: node.mimetype ?? "application/octet-stream", fileName: node.fileName ?? undefined },
    quotedId: node.contextInfo?.stanzaId ?? undefined,
  };
}

/** Tipos que não são conteúdo de conversa (controle, reação, voto...). Não viram mensagem. */
const IGNORED_KEYS = new Set([
  "reactionMessage",
  "encReactionMessage",
  "protocolMessage",
  "senderKeyDistributionMessage",
  "messageContextInfo",
  "pollUpdateMessage",
  "keepInChatMessage",
  "pinInChatMessage",
  "editedMessage",
  "deviceSentMessage",
  "callLogMesssage",
  "bcallMessage",
]);

export const UNSUPPORTED_BODY = "[Mensagem não suportada pelo WhatsOn — veja no celular]";

const LINE_BREAK = /\r?\n/;
const CONTACT_SEPARATOR = "\n\n";

function vcardPhones(vcard: unknown): string[] {
  if (typeof vcard !== "string") return [];
  return vcard
    .split(LINE_BREAK)
    .filter((line) => /^(item\d+\.)?TEL[;:]/i.test(line))
    .map((line) => line.slice(line.indexOf(":") + 1).trim())
    .filter(Boolean);
}

function vcardName(vcard: unknown): string | undefined {
  if (typeof vcard !== "string") return undefined;
  const fn = vcard.split(LINE_BREAK).find((line) => /^FN[;:]/i.test(line));
  return fn ? fn.slice(fn.indexOf(":") + 1).trim() || undefined : undefined;
}

function contactText(c: Json): string {
  const name = c?.displayName || vcardName(c?.vcard) || "sem nome";
  return [`👤 Contato: ${name}`, ...vcardPhones(c?.vcard).map((tel) => `📞 ${tel}`)].join("\n");
}

function extractContent(raw: Json): Content | null {
  const m: Json =
    raw.ephemeralMessage?.message ??
    raw.viewOnceMessage?.message ??
    raw.viewOnceMessageV2?.message ??
    raw.documentWithCaptionMessage?.message ??
    raw;
  if (typeof m.conversation === "string") return { type: "text", body: m.conversation };
  if (m.extendedTextMessage) {
    return {
      type: "text",
      body: m.extendedTextMessage.text ?? "",
      quotedId: m.extendedTextMessage.contextInfo?.stanzaId ?? undefined,
    };
  }
  if (m.imageMessage) return mediaContent("image", m.imageMessage, m.imageMessage.caption ?? "");
  if (m.videoMessage) return mediaContent("video", m.videoMessage, m.videoMessage.caption ?? "");
  if (m.audioMessage) return mediaContent("audio", m.audioMessage, "");
  if (m.documentMessage) {
    return mediaContent("document", m.documentMessage, m.documentMessage.caption ?? m.documentMessage.fileName ?? "");
  }
  if (m.stickerMessage) return mediaContent("sticker", m.stickerMessage, "");
  if (m.locationMessage) {
    return { type: "location", body: `${m.locationMessage.degreesLatitude},${m.locationMessage.degreesLongitude}` };
  }
  if (m.liveLocationMessage) {
    return { type: "location", body: `${m.liveLocationMessage.degreesLatitude},${m.liveLocationMessage.degreesLongitude}` };
  }
  if (m.contactMessage) return { type: "text", body: contactText(m.contactMessage) };
  if (m.contactsArrayMessage) {
    const contacts: Json[] = Array.isArray(m.contactsArrayMessage.contacts) ? m.contactsArrayMessage.contacts : [];
    return { type: "text", body: contacts.map(contactText).join(CONTACT_SEPARATOR) || "👤 Contato" };
  }
  const poll = m.pollCreationMessage ?? m.pollCreationMessageV2 ?? m.pollCreationMessageV3;
  if (poll) {
    const options: Json[] = Array.isArray(poll.options) ? poll.options : [];
    return { type: "text", body: [`📊 Enquete: ${poll.name ?? ""}`, ...options.map((o) => `• ${o.optionName ?? ""}`)].join("\n") };
  }
  const reply =
    m.buttonsResponseMessage?.selectedDisplayText ??
    m.listResponseMessage?.title ??
    m.templateButtonReplyMessage?.selectedDisplayText ??
    m.interactiveResponseMessage?.body?.text;
  if (typeof reply === "string") return { type: "text", body: reply };
  // Qualquer outro tipo de conteúdo não pode sumir: grava um aviso para o atendente olhar no celular.
  if (Object.keys(m).some((k) => !IGNORED_KEYS.has(k))) return { type: "text", body: UNSUPPORTED_BODY };
  return null;
}

function parseMessage(instanceName: string, d: Json): InboundMessage[] {
  if (!d?.key?.id || !d.message) return [];
  const remote = resolveRemote(d.key);
  if (!remote) return [];
  const content = extractContent(d.message);
  if (!content) return [];
  const sender = remote.isGroup ? groupSender(d.key) : undefined;
  return [
    {
      kind: "message",
      instanceName,
      providerMessageId: String(d.key.id),
      remoteNumber: remote.number,
      isGroup: remote.isGroup,
      fromMe: Boolean(d.key.fromMe),
      pushName: d.pushName || undefined,
      ...(remote.isGroup ? { senderNumber: sender, senderName: d.pushName || undefined } : {}),
      type: content.type,
      body: content.body,
      media: content.media,
      quotedProviderMessageId: content.quotedId,
      timestamp: Number.isFinite(Number(d.messageTimestamp)) && d.messageTimestamp != null ? Number(d.messageTimestamp) : Math.floor(Date.now() / 1000),
    },
  ];
}

function parseAck(instanceName: string, d: Json): AckUpdate[] {
  const id = d?.keyId ?? d?.key?.id;
  const ack = ACKS[String(d?.status ?? "")];
  if (!id || !ack) return [];
  const remote = resolveRemote({ remoteJid: d.remoteJid ?? d.key?.remoteJid });
  return [{ kind: "ack", instanceName, providerMessageId: String(id), remoteNumber: remote?.number ?? null, ack }];
}

export function parseEvolutionWebhook(payload: unknown): InboundEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Json;
  const event = String(p.event ?? "").toLowerCase().replace(/_/g, ".");
  const instanceName = String(p.instance ?? p.data?.instance ?? "");
  const items: Json[] = Array.isArray(p.data) ? p.data : [p.data ?? {}];

  switch (event) {
    case "messages.upsert":
      return items.flatMap((d) => parseMessage(instanceName, d));
    case "messages.update":
      return items.flatMap((d) => parseAck(instanceName, d));
    case "connection.update": {
      const state = EVOLUTION_STATES[String(p.data?.state ?? "")];
      if (!state) return [];
      const wuid = p.data?.wuid;
      return [
        {
          kind: "connection",
          instanceName,
          state,
          ...(typeof wuid === "string" && wuid ? { number: jidUser(wuid) } : {}),
        },
      ];
    }
    case "qrcode.updated": {
      const qr = p.data?.qrcode?.base64;
      return typeof qr === "string" && qr ? [{ kind: "qrcode", instanceName, qrBase64: qr }] : [];
    }
    default:
      return [];
  }
}
