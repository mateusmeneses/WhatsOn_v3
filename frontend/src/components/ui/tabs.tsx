import { useRef, type KeyboardEvent } from "react";
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
  const listRef = useRef<HTMLDivElement>(null);

  /** Padrão ARIA de abas: setas, Home e End movem a seleção (só a aba ativa entra na ordem do Tab). */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = items.findIndex((item) => item.value === value);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    onChange(items[next]!.value);
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div ref={listRef} role="tablist" onKeyDown={onKeyDown} className={cn("flex gap-1 rounded-lg bg-background p-1", className)}>
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={cn(
              // flex-auto + nowrap: rótulos não quebram na coluna de 320px (tablet, 768px); texto maior a partir de lg.
              "flex flex-auto items-center justify-center gap-1 whitespace-nowrap rounded-md px-1 py-1.5 text-xs font-medium text-ink-muted transition lg:px-2 lg:text-sm",
              selected ? "bg-surface font-semibold text-primary shadow-card" : "hover:text-ink",
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
