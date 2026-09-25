"use client";

import { cn } from "@/lib/utils";
import { MODE_LABELS, MODES } from "@/lib/mode";
import { useMode } from "@/components/shell/shell-context";

export function ModeToggle() {
  const { mode, overridden, setMode } = useMode();
  return (
    <div className="flex items-center gap-2">
      {overridden && (
        <span className="text-[11px] text-sky-400" title="Mode set by the link you opened. Your saved preference is unchanged.">
          Shared view
        </span>
      )}
      <div role="radiogroup" aria-label="View mode" className="flex h-7 items-center rounded-md border p-0.5 text-xs">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              "h-full rounded-[5px] px-2 font-medium transition-colors",
              mode === m ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>
    </div>
  );
}
