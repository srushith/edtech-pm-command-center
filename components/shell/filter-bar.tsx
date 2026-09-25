"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { FilterOptions } from "@/lib/data/filters";
import {
  activeFilterCount,
  applyFilters,
  describeDateRange,
  EMPTY_FILTERS,
  parseFilters,
  RANGE_LABELS,
  RANGE_PRESETS,
  REGION_LABELS,
  REGIONS,
  type FilterState,
} from "@/lib/filters";

const ALL = "__all";

function FilterSelect({
  label,
  value,
  items,
  onChange,
  className,
}: {
  label: string;
  value: string | null;
  items: { value: string; label: string }[];
  onChange: (value: string | null) => void;
  className?: string;
}) {
  const all = { value: ALL, label };
  return (
    <Select
      items={[all, ...items]}
      value={value ?? ALL}
      onValueChange={(v) => onChange(v === ALL || v == null ? null : String(v))}
    >
      <SelectTrigger size="sm" aria-label={label} className={cn("text-xs", value && "border-sky-500/40", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {[all, ...items].map((i) => (
          <SelectItem key={i.value} value={i.value} className="text-xs">
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DateRangePicker({ state, onChange }: { state: FilterState; onChange: (s: Partial<FilterState>) => void }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(state.from ?? "");
  const [to, setTo] = useState(state.to ?? "");
  const customValid = from !== "" || to !== "";

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setFrom(state.from ?? "");
          setTo(state.to ?? "");
        }
        setOpen(o);
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className={cn("text-xs font-normal", state.range !== EMPTY_FILTERS.range && "border-sky-500/40")} />
        }
      >
        <CalendarRange />
        {describeDateRange(state)}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <div className="grid grid-cols-2 gap-1">
          {RANGE_PRESETS.map((r) => (
            <Button
              key={r}
              size="xs"
              variant={state.range === r ? "secondary" : "ghost"}
              className="justify-start"
              onClick={() => {
                onChange({ range: r, from: null, to: null });
                setOpen(false);
              }}
            >
              {RANGE_LABELS[r]}
            </Button>
          ))}
        </div>
        <form
          className="space-y-2 border-t pt-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!customValid) return;
            onChange({ range: "custom", from: from || null, to: to || null });
            setOpen(false);
          }}
        >
          <p className="text-xs font-medium text-muted-foreground">Custom range</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-[11px] text-muted-foreground">
              From
              <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)}
                className="h-7 w-full rounded-md border bg-transparent px-1.5 text-xs text-foreground [color-scheme:inherit]" />
            </label>
            <label className="space-y-1 text-[11px] text-muted-foreground">
              To
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)}
                className="h-7 w-full rounded-md border bg-transparent px-1.5 text-xs text-foreground [color-scheme:inherit]" />
            </label>
          </div>
          <Button type="submit" size="xs" className="w-full" disabled={!customValid}>
            Apply
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

export function FilterBar({ options }: { options: FilterOptions }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const state = parseFilters(params);

  const update = (patch: Partial<FilterState>) => {
    const next = { ...state, ...patch };
    // Keep the selection coherent: a cohort implies its course; region narrows courses.
    const cohort = options.cohorts.find((c) => c.code === next.cohort);
    if (patch.cohort && cohort) next.course = cohort.courseCode;
    const course = options.courses.find((c) => c.code === next.course);
    if (next.region && course && course.region !== next.region) next.course = null;
    if (next.cohort && (!cohort || (next.course && cohort.courseCode !== next.course) || (next.region && cohort.region !== next.region)))
      next.cohort = null;
    const qs = applyFilters(params, next).toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  const courses = options.courses.filter((c) => !state.region || c.region === state.region);
  const cohorts = options.cohorts.filter(
    (c) => (!state.course || c.courseCode === state.course) && (!state.region || c.region === state.region),
  );
  const active = activeFilterCount(state);

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Global filters">
      <FilterSelect
        label="All courses"
        value={state.course}
        items={courses.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))}
        onChange={(course) => update({ course })}
        className="max-w-52"
      />
      <FilterSelect
        label="All cohorts"
        value={state.cohort}
        items={cohorts.map((c) => ({ value: c.code, label: c.code }))}
        onChange={(cohort) => update({ cohort })}
      />
      <FilterSelect
        label="All regions"
        value={state.region}
        items={REGIONS.map((r) => ({ value: r, label: REGION_LABELS[r] }))}
        onChange={(region) => update({ region: region as FilterState["region"] })}
      />
      <DateRangePicker state={state} onChange={update} />
      {active > 0 && (
        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => update(EMPTY_FILTERS)}>
          <X />
          Clear
        </Button>
      )}
    </div>
  );
}
