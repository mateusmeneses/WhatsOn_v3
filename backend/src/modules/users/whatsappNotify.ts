import { Connection, User } from "../../models";
import { logger } from "../../shared/logger";
import { getProvider } from "../whatsapp/registry";

/** Envia um texto ao celular do usuário pelo WhatsApp da empresa (conexão padrão primeiro). Nunca lança: devolve se enviou. */
export async function sendTextToUser(user: Pick<User, "id" | "companyId" | "phone">, text: string): Promise<boolean> {
  if (!user.phone || user.companyId === null) return false;
  const connection = await Connection.findOne({
    where: { companyId: user.companyId, status: "connected" },
    order: [
      ["isDefault", "DESC"],
      ["id", "ASC"],
    ],
  });
  if (!connection) return false;
  try {
    await getProvider().sendText(connection.instanceName, user.phone, text);
    return true;
  } catch (err) {
    // Nunca logar o texto: pode conter senha.
    logger.warn({ err: (err as Error).message, userId: user.id }, "failed to send whatsapp to user");
    return false;
  }
}
