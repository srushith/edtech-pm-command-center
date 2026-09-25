import { cn } from "@/lib/utils";

// Color is reserved for status (see CLAUDE.md design rules).
export type Status = "healthy" | "attention" | "critical" | "info" | "ai";

const styles: Record<Status, string> = {
  healthy: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  attention: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  critical: "border-red-500/30 bg-red-500/10 text-red-400",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  ai: "border-violet-500/30 bg-violet-500/10 text-violet-400",
};

export function StatusBadge({
  status,
  children,
  className,
}: {
  status: Status;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded border px-1.5 text-[11px] font-medium tabular-nums",
        styles[status],
        className,
      )}
    >
      {children}
    </span>
  );
}
