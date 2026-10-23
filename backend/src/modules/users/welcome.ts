import { randomInt } from "node:crypto";
import { env } from "../../config/env";
import { User } from "../../models";
import { AppError } from "../../shared/errors/AppError";
import { sendTextToUser } from "./whatsappNotify";

/** Sem caracteres ambíguos (0/O, 1/l/I) para quem digita a senha lida no celular. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateTemporaryPassword(length = 10): string {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

/** Só dígitos, com DDI 55 quando vier só DDD + número. */
export function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (digits.length < 12 || digits.length > 15) throw new AppError("INVALID_PHONE", 400, "Telefone inválido");
  return digits;
}

export function welcomeText(user: Pick<User, "name" | "email">, password: string): string {
  return [
    `Olá, ${user.name}! Seu acesso ao WhatsOn foi criado.`,
    "",
    `Link: ${env.FRONTEND_URL}`,
    `Usuário: ${user.email}`,
    `Senha temporária: ${password}`,
    "",
    "No primeiro acesso você deverá cadastrar uma nova senha.",
  ].join("\n");
}

/** Envia o acesso pelo WhatsApp da empresa (conexão padrão primeiro). Nunca lança: devolve se enviou. */
export function sendAccessMessage(user: User, password: string): Promise<boolean> {
  return sendTextToUser(user, welcomeText(user, password));
}
