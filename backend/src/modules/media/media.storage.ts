import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env";
import { AppError } from "../../shared/errors/AppError";

export interface StoredMedia {
  url: string;
  mime: string;
  name: string | null;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
};

/** Extensão vem só da allowlist de MIME; nunca do nome enviado pelo cliente. */
function extensionFor(mime: string): string {
  return EXTENSIONS[mime] ?? "bin";
}

/** Extensões servidas inline (imagem/áudio/vídeo); o resto vai como anexo. */
const INLINE_EXTENSIONS = new Set(
  Object.entries(EXTENSIONS)
    .filter(([mime]) => /^(image|audio|video)\//.test(mime))
    .map(([, ext]) => ext),
);

export function isInlineMediaFile(filePath: string): boolean {
  return INLINE_EXTENSIONS.has(path.extname(filePath).slice(1).toLowerCase());
}

export async function saveBuffer(
  companyId: number,
  buffer: Buffer,
  mime: string,
  name: string | null = null,
): Promise<StoredMedia> {
  const baseMime = mime.split(";")[0].trim().toLowerCase() || "application/octet-stream";
  const fileName = `${randomUUID()}.${extensionFor(baseMime)}`;
  const dir = path.resolve(env.MEDIA_DIR, String(companyId));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), buffer);
  return { url: `/media/${companyId}/${fileName}`, mime: baseMime, name };
}

export function saveBase64(companyId: number, base64: string, mime: string, name: string | null = null) {
  const raw = base64.replace(/^data:[^,]*,/, "");
  return saveBuffer(companyId, Buffer.from(raw, "base64"), mime, name);
}

const MEDIA_URL = /^\/media\/(\d+)\/([a-f0-9-]+\.[a-z0-9]+)$/i;

export function resolveMediaPath(companyId: number, url: string): string {
  const match = MEDIA_URL.exec(url);
  if (!match || Number(match[1]) !== companyId) throw new AppError("INVALID_MEDIA", 400, "Mídia inválida");
  return path.resolve(env.MEDIA_DIR, match[1], match[2]);
}

export async function readMediaBase64(companyId: number, url: string): Promise<string> {
  return (await fs.readFile(resolveMediaPath(companyId, url))).toString("base64");
}

export function mediaTypeFromMime(mime: string): "image" | "audio" | "video" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}
