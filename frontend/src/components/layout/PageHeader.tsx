import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
  icon: Icon,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-surface px-4 py-4 sm:px-6 sm:py-5">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary sm:grid">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
