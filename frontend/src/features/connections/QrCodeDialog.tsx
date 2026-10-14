import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/apiError";
import { useRealtimeEvent } from "@/realtime/RealtimeProvider";
import type { Connection } from "@/types/api";
import { fetchQrCode } from "./connectionsApi";
import { useConnections } from "./useConnections";

export function QrCodeDialog({ connection, onClose }: { connection: Connection; onClose: () => void }) {
  const qrQuery = useQuery({
    queryKey: ["connections", connection.id, "qrcode"],
    queryFn: () => fetchQrCode(connection.id),
    gcTime: 0,
  });
  const [liveQr, setLiveQr] = useState<string | null>(null);
  const connections = useConnections();
  const current = connections.data?.find((c) => c.id === connection.id);

  useRealtimeEvent<{ connectionId: number; qr: string }>("connection:qrcode", (payload) => {
    if (payload.connectionId === connection.id) setLiveQr(payload.qr);
  });

  useEffect(() => {
    if (current?.status === "connected") {
      toast.success("WhatsApp conectado");
      onClose();
    }
  }, [current?.status, onClose]);

  const qr = liveQr ?? qrQuery.data?.qr ?? null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`Conectar ${connection.name}`}
        description="No celular, abra o WhatsApp > Aparelhos conectados > Conectar um aparelho e aponte a câmera para o código."
      >
        <div className="flex min-h-64 items-center justify-center">
          {qrQuery.isError ? (
            <p className="text-sm text-danger">{errorMessage(qrQuery.error)}</p>
          ) : qr ? (
            <img src={qr} alt="QR code do WhatsApp" className="h-64 w-64 rounded-lg border border-border" />
          ) : (
            <Spinner className="h-8 w-8" />
          )}
        </div>
        <p className="mt-2 text-center text-xs text-ink-muted">O código é renovado automaticamente.</p>
      </DialogContent>
    </Dialog>
  );
}
