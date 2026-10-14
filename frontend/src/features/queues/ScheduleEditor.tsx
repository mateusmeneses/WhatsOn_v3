import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WeekSchedule } from "@/types/api";
import { DAYS, isAlwaysOpen, setDayRanges } from "./schedule";

const DEFAULT_RANGE = "08:00-18:00";

export function ScheduleEditor({ value, onChange }: { value: WeekSchedule; onChange: (value: WeekSchedule) => void }) {
  const alwaysOpen = isAlwaysOpen(value);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--color-primary)]"
          checked={alwaysOpen}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? {}
                : { "0": [], "1": [DEFAULT_RANGE], "2": [DEFAULT_RANGE], "3": [DEFAULT_RANGE], "4": [DEFAULT_RANGE], "5": [DEFAULT_RANGE], "6": [] },
            )
          }
        />
        Sempre aberto
      </label>
      {!alwaysOpen && (
        <div className="divide-y divide-border rounded-lg border border-border">
          {DAYS.map(({ key, label }) => {
            const ranges = value[key] ?? [];
            const open = ranges.length > 0;
            return (
              <div key={key} className="flex items-start gap-3 px-3 py-2">
                <label className="flex w-32 items-center gap-2 pt-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`${label} aberto`}
                    className="h-4 w-4 accent-[var(--color-primary)]"
                    checked={open}
                    onChange={(e) => onChange(setDayRanges(value, key, e.target.checked ? [DEFAULT_RANGE] : []))}
                  />
                  {label}
                </label>
                <div className="flex-1 space-y-2">
                  {!open && <p className="pt-2 text-sm text-ink-muted">Fechado</p>}
                  {ranges.map((range, index) => {
                    const [start = "", end = ""] = range.split("-");
                    const update = (s: string, e: string) => {
                      const copy = [...ranges];
                      copy[index] = `${s}-${e}`;
                      onChange({ ...value, [key]: copy });
                    };
                    return (
                      <div key={index} className="flex items-center gap-2">
                        <Input
                          type="time"
                          aria-label={`${label} início ${index + 1}`}
                          className="w-32"
                          value={start}
                          onChange={(e) => update(e.target.value, end)}
                        />
                        <span className="text-ink-muted">às</span>
                        <Input
                          type="time"
                          aria-label={`${label} fim ${index + 1}`}
                          className="w-32"
                          value={end === "24:00" ? "23:59" : end}
                          onChange={(e) => update(start, e.target.value === "23:59" ? "24:00" : e.target.value)}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remover horário"
                          onClick={() => onChange(setDayRanges(value, key, ranges.filter((_, i) => i !== index)))}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    );
                  })}
                  {open && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onChange(setDayRanges(value, key, [...ranges, "13:00-18:00"]))}
                    >
                      <Plus className="h-4 w-4" aria-hidden /> Adicionar horário
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
