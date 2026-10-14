import { toast } from "sonner";
import { useRealtimeEvent } from "@/realtime/RealtimeProvider";

export function ConnectionAlerts() {
  useRealtimeEvent<{ connectionId: number; name: string }>("connection:alert", ({ name }) => {
    toast.error(`A conexão "${name}" caiu. Gere um novo QR code para reconectar.`);
  });
  return null;
}
