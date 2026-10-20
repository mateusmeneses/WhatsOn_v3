import { useAppVersion } from "./useAppVersion";

/** Versão discreta no canto inferior direito, como no rodapé do MultiComércio. */
export function VersionBadge() {
  const { data } = useAppVersion();
  if (!data) return null;
  return (
    <footer aria-label="Versão do sistema" className="pointer-events-none fixed bottom-1 right-2 z-10 select-none text-[11px] leading-none text-ink-muted">
      v{data.version}
    </footer>
  );
}
