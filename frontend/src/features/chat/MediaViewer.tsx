import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";

export interface ViewerMedia {
  kind: "image" | "video";
  src: string;
  name: string;
}

/** Visualizador em tela cheia: foto ampliada ou vídeo já tocando. */
export function MediaViewer({ media, onClose }: { media: ViewerMedia | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(media)} onOpenChange={(open) => !open && onClose()}>
      {media && (
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/85" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 focus:outline-none"
            onClick={(e) => e.target === e.currentTarget && onClose()}
          >
            <DialogPrimitive.Title className="sr-only">{media.name}</DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Fechar"
              className="absolute right-4 top-4 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
            >
              <X className="h-5 w-5" aria-hidden />
            </DialogPrimitive.Close>
            {media.kind === "image" ? (
              <img src={media.src} alt={media.name} className="max-h-full max-w-full rounded-lg object-contain" />
            ) : (
              <video src={media.src} controls autoPlay className="max-h-full max-w-full rounded-lg" />
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      )}
    </Dialog>
  );
}
