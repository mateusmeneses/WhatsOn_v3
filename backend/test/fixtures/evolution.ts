type Json = Record<string, unknown>;

export function upsert(data: Json, instance = "inst_1"): Json {
  return { event: "messages.upsert", instance, data };
}

export function textMessage(opts: { id?: string; from?: string; text?: string; fromMe?: boolean; pushName?: string } = {}): Json {
  return upsert({
    key: { remoteJid: `${opts.from ?? "5511988887777"}@s.whatsapp.net`, fromMe: opts.fromMe ?? false, id: opts.id ?? "MSG1" },
    pushName: opts.pushName ?? "Maria",
    message: { conversation: opts.text ?? "Oi" },
    messageType: "conversation",
    messageTimestamp: 1760000000,
  });
}

export function imageMessage(opts: { id?: string; from?: string; caption?: string } = {}): Json {
  return upsert({
    key: { remoteJid: `${opts.from ?? "5511988887777"}@s.whatsapp.net`, fromMe: false, id: opts.id ?? "IMG1" },
    pushName: "Maria",
    message: { imageMessage: { caption: opts.caption ?? "comprovante", mimetype: "image/jpeg" } },
    messageType: "imageMessage",
    messageTimestamp: 1760000000,
  });
}

export function documentMessage(
  opts: { id?: string; from?: string; fromMe?: boolean; fileName?: string; caption?: string } = {},
): Json {
  return upsert({
    key: { remoteJid: `${opts.from ?? "5511988887777"}@s.whatsapp.net`, fromMe: opts.fromMe ?? false, id: opts.id ?? "DOC1" },
    pushName: "Maria",
    message: {
      documentMessage: { fileName: opts.fileName ?? "arquivo.pdf", mimetype: "application/pdf", ...(opts.caption ? { caption: opts.caption } : {}) },
    },
    messageType: "documentMessage",
    messageTimestamp: 1760000000,
  });
}

export function ackUpdate(id: string, status: string, from = "5511988887777"): Json {
  return {
    event: "messages.update",
    instance: "inst_1",
    data: { keyId: id, remoteJid: `${from}@s.whatsapp.net`, fromMe: true, status },
  };
}

export function connectionUpdate(state: string): Json {
  return {
    event: "connection.update",
    instance: "inst_1",
    data: { instance: "inst_1", state, wuid: "5511999990000@s.whatsapp.net" },
  };
}

export function qrcodeUpdate(): Json {
  return {
    event: "qrcode.updated",
    instance: "inst_1",
    data: { qrcode: { instance: "inst_1", code: "2@abc", base64: "data:image/png;base64,QRDATA" } },
  };
}
