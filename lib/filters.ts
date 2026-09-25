// Global filters live in URL search params so every view is shareable.
// Shared by server pages (parse `searchParams`) and client controls (write the URL).
import { DEMO_TODAY } from "@/lib/domain/time";

export const REGIONS = ["US", "INDIA", "GLOBAL"] as const;
export type RegionCode = (typeof REGIONS)[number];
export const REGION_LABELS: Record<RegionCode, string> = { US: "US", INDIA: "India", GLOBAL: "Global" };

export const RANGE_PRESETS = ["7d", "30d", "90d", "qtd", "all"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const RANGE_LABELS: Record<RangePreset | "custom", string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  qtd: "Quarter to date",
  all: "All time",
  custom: "Custom",
};
export const DEFAULT_RANGE: RangePreset = "30d";

// Param keys. `from`/`to` (YYYY-MM-DD) together mean a custom range and win over `range`.
export const FILTER_KEYS = ["course", "cohort", "region", "range", "from", "to"] as const;

export type FilterState = {
  course: string | null; // Course.code, e.g. "AAI"
  cohort: string | null; // Cohort.code, e.g. "AAI-C1"
  region: RegionCode | null;
  range: RangePreset | "custom";
  from: string | null;
  to: string | null;
};

export const EMPTY_FILTERS: FilterState = {
  course: null, cohort: null, region: null, range: DEFAULT_RANGE, from: null, to: null,
};

type ParamSource =
  | URLSearchParams
  | { get(key: string): string | null }
  | Record<string, string | string[] | undefined>;

function read(params: ParamSource, key: string): string | null {
  if (typeof (params as URLSearchParams).get === "function") return (params as URLSearchParams).get(key);
  const v = (params as Record<string, string | string[] | undefined>)[key];
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

const CODE = /^[A-Za-z0-9-]{1,32}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (s: string | null) => (s && ISO_DAY.test(s) && !Number.isNaN(Date.parse(s)) ? s : null);

/** Parse and validate; unknown or malformed values are dropped rather than trusted. */
export function parseFilters(params: ParamSource): FilterState {
  const course = read(params, "course");
  const cohort = read(params, "cohort");
  const region = read(params, "region")?.toUpperCase() ?? null;
  const range = read(params, "range");
  let from = validDay(read(params, "from"));
  let to = validDay(read(params, "to"));
  if (from && to && from > to) [from, to] = [to, from];
  const custom = from != null || to != null;
  return {
    course: course && CODE.test(course) ? course : null,
    cohort: cohort && CODE.test(cohort) ? cohort : null,
    region: REGIONS.includes(region as RegionCode) ? (region as RegionCode) : null,
    range: custom ? "custom" : RANGE_PRESETS.includes(range as RangePreset) ? (range as RangePreset) : DEFAULT_RANGE,
    from: custom ? from : null,
    to: custom ? to : null,
  };
}

/** Write filters onto a copy of `base`, keeping unrelated params. Defaults are omitted. */
export function applyFilters(base: URLSearchParams | string, state: FilterState): URLSearchParams {
  const next = new URLSearchParams(base.toString());
  for (const k of FILTER_KEYS) next.delete(k);
  if (state.course) next.set("course", state.course);
  if (state.cohort) next.set("cohort", state.cohort);
  if (state.region) next.set("region", state.region.toLowerCase());
  if (state.range === "custom") {
    if (state.from) next.set("from", state.from);
    if (state.to) next.set("to", state.to);
  } else if (state.range !== DEFAULT_RANGE) {
    next.set("range", state.range);
  }
  return next;
}

/** Only the filter params, for carrying filters across navigation. */
export function filterQuery(params: URLSearchParams | { toString(): string }): string {
  const qs = applyFilters("", parseFilters(new URLSearchParams(params.toString()))).toString();
  return qs ? `?${qs}` : "";
}

export function activeFilterCount(s: FilterState): number {
  return [s.course, s.cohort, s.region, s.range !== DEFAULT_RANGE ? s.range : null].filter(Boolean).length;
}

const DAY_MS = 86_400_000;
const utcDay = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Concrete window relative to the demo "today". `null` bounds mean open-ended. */
export function resolveDateRange(s: FilterState): { start: Date | null; end: Date | null } {
  const end = DEMO_TODAY;
  switch (s.range) {
    case "7d": return { start: new Date(end.getTime() - 7 * DAY_MS), end };
    case "30d": return { start: new Date(end.getTime() - 30 * DAY_MS), end };
    case "90d": return { start: new Date(end.getTime() - 90 * DAY_MS), end };
    case "qtd": {
      const q = Math.floor(end.getUTCMonth() / 3) * 3;
      return { start: new Date(Date.UTC(end.getUTCFullYear(), q, 1)), end };
    }
    case "all": return { start: null, end: null };
    case "custom":
      return {
        start: s.from ? utcDay(s.from) : null,
        end: s.to ? new Date(utcDay(s.to).getTime() + DAY_MS - 1) : null,
      };
  }
}

const fmtDay = (d: Date) =>
  d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function describeDateRange(s: FilterState): string {
  if (s.range !== "custom") return RANGE_LABELS[s.range];
  const { start, end } = resolveDateRange(s);
  return `${start ? fmtDay(start) : "…"} – ${end ? fmtDay(end) : "…"}`;
}
