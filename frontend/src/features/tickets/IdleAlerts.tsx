import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { playAlarm } from "@/lib/notifySound";
import { useRealtimeEvent } from "@/realtime/RealtimeProvider";

export interface IdleAlert {
  ticketId: number;
  contactName: string;
  agentName: string;
  minutes: number;
  level: number;
  /** Aviso para supervisores e admins (atendimento de outro técnico). */
  escalated: boolean;
}

const ASKED_KEY = "whatson.notify-asked";

function canNotify(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function idleAlertText(alert: IdleAlert): { title: string; body: string } {
  if (alert.escalated) {
    return {
      title: "Atendimento sem resposta",
      body: `${alert.contactName} está há ${alert.minutes} min sem resposta com ${alert.agentName} (#${alert.ticketId}).`,
    };
  }
  return {
    title: alert.level >= 3 ? "URGENTE: cliente sem resposta" : "Cliente sem resposta",
    body: `${alert.contactName} está há ${alert.minutes} min esperando sua resposta (#${alert.ticketId}).`,
  };
}

/** Pede, uma vez por sessão, permissão para os pop-ups do sistema. */
function useAskNotificationPermission() {
  useEffect(() => {
    if (!canNotify() || Notification.permission !== "default") return;
    try {
      if (sessionStorage.getItem(ASKED_KEY)) return;
      sessionStorage.setItem(ASKED_KEY, "1");
    } catch {
      // sem sessionStorage: pergunta a cada carga
    }
    toast("Ative as notificações para ser avisado de clientes sem resposta.", {
      duration: 20_000,
      action: { label: "Ativar", onClick: () => void Notification.requestPermission() },
    });
  }, []);
}

/** Alerta de atendimento parado: alarme sonoro, pop-up do sistema e aviso na tela, com atalho para o atendimento. */
export function IdleAlerts() {
  const navigate = useNavigate();
  useAskNotificationPermission();

  useRealtimeEvent<IdleAlert>("ticket:idle-alert", (alert) => {
    const open = () => {
      window.focus();
      navigate(`/atendimento/${alert.ticketId}`);
    };
    const { title, body } = idleAlertText(alert);
    playAlarm();
    toast.warning(title, {
      id: `idle-${alert.ticketId}-${alert.escalated ? "sup" : "agent"}`,
      description: body,
      duration: Infinity,
      action: { label: "Abrir", onClick: open },
    });
    if (canNotify() && Notification.permission === "granted") {
      try {
        const notification = new Notification(title, { body, tag: `whatson-idle-${alert.ticketId}`, requireInteraction: true });
        notification.onclick = () => {
          open();
          notification.close();
        };
      } catch {
        // navegador sem pop-up fora de service worker: o aviso na tela basta
      }
    }
  });

  return null;
}
