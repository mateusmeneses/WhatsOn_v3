import dns from "node:dns";
import net from "node:net";
import path from "node:path";
import axios, { AxiosResponse } from "axios";
import { AppError } from "../../shared/errors/AppError";

export const MAX_REMOTE_MEDIA_BYTES = 16 * 1024 * 1024;
const MAX_REDIRECTS = 3;

const invalidUrl = (message = "URL da mídia inválida") => new AppError("INVALID_MEDIA_URL", 400, message);
const downloadFailed = (message = "Não foi possível baixar a mídia da URL") =>
  new AppError("MEDIA_DOWNLOAD_FAILED", 400, message);

function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v6 = address.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

/** Bloqueia URLs para a rede interna (SSRF): só http(s) e só hosts que resolvem para IP público. */
async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalidUrl();
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw invalidUrl("Use uma URL http ou https");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host)
    ? [host]
    : (await dns.promises.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw invalidUrl("Não foi possível resolver o endereço da mídia");
  if (addresses.some(isPrivateAddress)) throw invalidUrl("Endereço da mídia não permitido");
  return url;
}

function nameFromUrl(url: URL): string | null {
  try {
    return path.posix.basename(decodeURIComponent(url.pathname)) || null;
  } catch {
    return null;
  }
}

/** Baixa a mídia seguindo até 3 redirecionamentos, revalidando o destino a cada salto. */
export async function fetchRemoteMedia(raw: string): Promise<{ buffer: Buffer; mime: string; name: string | null }> {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: AxiosResponse<ArrayBuffer>;
    try {
      res = await axios.get<ArrayBuffer>(url.toString(), {
        responseType: "arraybuffer",
        maxRedirects: 0,
        timeout: 20_000,
        maxContentLength: MAX_REMOTE_MEDIA_BYTES,
        validateStatus: (s) => s >= 200 && s < 400,
      });
    } catch (err) {
      if (axios.isAxiosError(err) && err.message.includes("maxContentLength")) {
        throw new AppError("MEDIA_TOO_LARGE", 400, "Mídia maior que 16 MB");
      }
      throw downloadFailed();
    }
    if (res.status >= 300) {
      const location = res.headers.location;
      if (!location) throw downloadFailed();
      url = await assertPublicUrl(new URL(String(location), url).toString());
      continue;
    }
    const mime = String(res.headers["content-type"] ?? "application/octet-stream");
    return { buffer: Buffer.from(res.data), mime, name: nameFromUrl(url) };
  }
  throw downloadFailed("Redirecionamentos demais ao baixar a mídia");
}
