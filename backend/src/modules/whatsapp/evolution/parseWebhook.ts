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

const STATES: Record<string, ConnectionStatus> = { open: "connected", connecting: "qrcode", close: "disconnected" };

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
  return null;
}

function parseMessage(instanceName: string, d: Json): InboundMessage[] {
  if (!d?.key?.id || !d.message) return [];
  const remote = resolveRemote(d.key);
  if (!remote) return [];
  const content = extractContent(d.message);
  if (!content) return [];
  return [
    {
      kind: "message",
      instanceName,
      providerMessageId: String(d.key.id),
      remoteNumber: remote.number,
      isGroup: remote.isGroup,
      fromMe: Boolean(d.key.fromMe),
      pushName: d.pushName || undefined,
      type: content.type,
      body: content.body,
      media: content.media,
      quotedProviderMessageId: content.quotedId,
      timestamp: Number(d.messageTimestamp ?? Math.floor(Date.now() / 1000)),
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
      const state = STATES[String(p.data?.state ?? "")];
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
