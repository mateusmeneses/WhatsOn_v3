import { cn } from "@/lib/cn";

export interface TabItem<T extends string> {
  value: T;
  label: string;
  count?: number;
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  items: TabItem<T>[];
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("flex gap-1 rounded-lg bg-background p-1", className)}>
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(item.value)}
            className={cn(
              // flex-auto + nowrap: rótulos não quebram na coluna de 320px (tablet, 768px); texto maior a partir de lg.
              "flex flex-auto items-center justify-center gap-1 whitespace-nowrap rounded-md px-1 py-1.5 text-xs font-medium text-ink-muted transition lg:px-2 lg:text-sm",
              selected && "bg-surface text-ink shadow-sm",
            )}
          >
            {item.label}
            {item.count ? <span className="rounded-full bg-primary px-1.5 text-xs text-white">{item.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
