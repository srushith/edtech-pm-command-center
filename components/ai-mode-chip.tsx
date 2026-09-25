import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/** The workspace's AI mode: purple while AI is available (mock or live), amber when it's off. */
export function AIModeChip({ label, kind, className }: { label: string; kind: string; className?: string }) {
  const off = kind === "off";
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded border px-1.5 text-[11px] font-medium",
        off ? "border-amber-500/30 bg-amber-500/10 text-amber-400" : "border-violet-500/30 bg-violet-500/10 text-violet-400",
        className,
      )}
    >
      <Sparkles className="size-3" /> {label}
    </span>
  );
}
