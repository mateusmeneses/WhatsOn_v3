import { createHash, randomBytes } from "node:crypto";

/** Chave de alta entropia: SHA-256 basta (sem bcrypt) e permite buscar pelo hash com índice. */
export function hashPartnerKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generatePartnerKey(): { key: string; keyHash: string; keyPrefix: string } {
  const key = `wpk_${randomBytes(24).toString("hex")}`;
  return { key, keyHash: hashPartnerKey(key), keyPrefix: key.slice(0, 12) };
}
