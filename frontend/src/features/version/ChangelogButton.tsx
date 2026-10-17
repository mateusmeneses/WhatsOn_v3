import { useQuery } from "@tanstack/react-query";
import { Sparkles, TrendingUp, Wrench, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { useAppVersion } from "./useAppVersion";
import { fetchChangelog, type ChangelogVersion } from "./versionApi";

function Section({ label, icon: Icon, className, items }: { label: string; icon: LucideIcon; className: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="mt-2">
      <p className={cn("flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide", className)}>
        <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
      </p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function VersionEntry({ entry, latest }: { entry: ChangelogVersion; latest: boolean }) {
  return (
    <article className={cn("rounded-lg border border-border p-3", latest && "border-primary bg-primary-soft/40")}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-primary px-2 py-0.5 font-semibold text-white">v{entry.versao}</span>
        {latest && <span className="font-medium text-primary">Mais recente</span>}
        <span className="ml-auto text-ink-muted">{entry.data}</span>
      </div>
      <h3 className="mt-2 font-semibold">{entry.titulo}</h3>
      <Section label="Novidades" icon={Sparkles} className="text-primary" items={entry.novidades} />
      <Section label="Melhorias" icon={TrendingUp} className="text-sky-600" items={entry.melhorias} />
      <Section label="Correções" icon={Wrench} className="text-ink-muted" items={entry.correcoes} />
    </article>
  );
}

/** "Novidades do sistema": últimas versões publicadas, lidas de /changelog.json. */
export function ChangelogButton() {
  const [open, setOpen] = useState(false);
  const version = useAppVersion();
  const changelog = useQuery({ queryKey: ["changelog"], queryFn: fetchChangelog, enabled: open, staleTime: 0 });
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Novidades desta versão"
        aria-label="Novidades desta versão"
        className="rounded-lg p-2.5 text-white/60 hover:bg-white/10 hover:text-white"
      >
        <Sparkles className="h-5 w-5" aria-hidden />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Novidades do sistema" className="max-w-2xl">
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {changelog.isLoading ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : changelog.data?.length ? (
              changelog.data.map((entry, i) => <VersionEntry key={entry.versao} entry={entry} latest={i === 0} />)
            ) : (
              <p className="text-sm text-ink-muted">Ainda não há novidades registradas.</p>
            )}
          </div>
          <DialogFooter>
            <span className="mr-auto self-center text-xs text-ink-muted">
              Versão instalada: {version.data?.version ?? "—"}
            </span>
            <Button onClick={() => setOpen(false)}>Entendi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
