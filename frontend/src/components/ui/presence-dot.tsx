import { cn } from "@/lib/cn";

/** Bolinha de presença; pulsa quando online. */
export function PresenceDot({ online, className }: { online: boolean; className?: string }) {
  return (
    <span
      className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", online ? "bg-brand-green motion-safe:animate-pulse-ring" : "bg-slate-300", className)}
      role="img"
      aria-label={online ? "Online" : "Offline"}
    />
  );
}
