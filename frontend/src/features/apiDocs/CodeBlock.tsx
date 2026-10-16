import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { HttpMethod } from "./endpoints";

export function CodeBlock({ code, label = "Copiar código", className }: { code: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("relative", className)}>
      <pre className="max-h-[28rem] overflow-auto rounded-lg bg-sidebar p-4 pr-12 font-mono text-xs leading-relaxed text-white/90">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        aria-label={label}
        title={label}
        className="absolute right-2 top-2 rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(
            () => {
              setCopied(true);
              toast.success("Copiado");
              setTimeout(() => setCopied(false), 1500);
            },
            () => undefined,
          );
        }}
      >
        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}

export function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <Badge tone={method === "GET" ? "success" : "primary"} className="font-mono">
      {method}
    </Badge>
  );
}

export function InlineCode({ children }: { children: string }) {
  return <code className="rounded bg-background px-1.5 py-0.5 font-mono text-[0.8em] text-ink">{children}</code>;
}
