import { env } from "../../config/env";
import { Connection } from "../../models";
import { logger } from "../../shared/logger";
import { getProvider } from "../whatsapp/registry";

export const CONNECTION_ALERT_JOB = "alerta-conexao";

export interface ConnectionAlertData {
  connectionId: number;
  status: "fora" | "voltou";
  /** Minutos que a conexão precisou ficar fora para virar alerta. */
  minutes: number;
}

export function connectionAlertText(name: string, data: ConnectionAlertData): string {
  return data.status === "fora"
    ? `🔴 WhatsOn — a conexão "${name}" está fora do ar há mais de ${data.minutes} min.\nVerifique em ${env.FRONTEND_URL}/conexoes`
    : `🟢 WhatsOn — a conexão "${name}" voltou a funcionar.`;
}

/** Job do alerta de conexão (queda prolongada ou volta), enviado direto aos destinos de ALERTA_CONEXAO_DESTINOS. */
export async function processConnectionAlert(data: ConnectionAlertData, numbers: string[]): Promise<void> {
  const connection = await Connection.findByPk(data.connectionId, { attributes: ["id", "name", "companyId"] });
  if (!connection) return;
  await sendAlert(connection.companyId, numbers, connectionAlertText(connection.name, data), connection.id);
}

/**
 * Alerta direto às pessoas (sem passar pela Claudia), pelo WhatsApp de uma conexão conectada da empresa
 * (a padrão primeiro). Se nenhuma estiver conectada, só registra no log. Nunca lança: devolve quantos enviou.
 */
export async function sendAlert(companyId: number, numbers: string[], text: string, exceptConnectionId?: number): Promise<number> {
  if (!numbers.length) return 0;
  const connections = await Connection.findAll({
    where: { companyId, status: "connected" },
    order: [
      ["isDefault", "DESC"],
      ["id", "ASC"],
    ],
  });
  const connection = connections.find((c) => c.id !== exceptConnectionId) ?? null;
  if (!connection) {
    logger.error({ companyId, alert: text.split("\n")[0] }, "alerta não enviado: nenhuma conexão de WhatsApp conectada");
    return 0;
  }
  let sent = 0;
  for (const number of numbers) {
    try {
      await getProvider().sendText(connection.instanceName, number, text);
      sent += 1;
    } catch (err) {
      logger.warn({ err: (err as Error).message, companyId, number: number.slice(-4) }, "falha ao enviar alerta por WhatsApp");
    }
  }
  return sent;
}
