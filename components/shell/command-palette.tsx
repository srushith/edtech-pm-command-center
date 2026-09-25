"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FilterX, Loader2, Moon, Presentation, Sun, UserRound } from "lucide-react";
import { useTheme } from "next-themes";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { ALL_SECTIONS, SECTIONS } from "@/lib/nav";
import { activeFilterCount, applyFilters, EMPTY_FILTERS, parseFilters } from "@/lib/filters";
import { MODE_LABELS } from "@/lib/mode";
import { ENTITY_LABELS, type EntityType, type SearchItem } from "@/lib/search-types";
import { searchIndex } from "@/app/(dashboard)/actions";
import { useHrefWithFilters, useMode, useShell } from "@/components/shell/shell-context";

const ENTITY_ORDER = Object.keys(ENTITY_LABELS) as EntityType[];
const GO_TIMEOUT_MS = 1200;

// Every typed word must appear somewhere in the item's text; label-prefix hits rank first.
// Stricter than cmdk's default fuzzy match, which over-matches on a few hundred records.
function filter(value: string, search: string, keywords?: string[]) {
  const haystack = `${value} ${keywords?.join(" ") ?? ""}`.toLowerCase();
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.every((t) => haystack.includes(t))) return 0;
  const label = value.slice(value.indexOf(" ") + 1).toLowerCase();
  return label.startsWith(terms[0] ?? "") ? 1 : 0.5;
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { paletteOpen: open, setPaletteOpen: setOpen } = useShell();
  const { mode, setMode } = useMode();
  const { resolvedTheme, setTheme } = useTheme();
  const withFilters = useHrefWithFilters();
  const [index, setIndex] = useState<SearchItem[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, startLoading] = useTransition();
  const goPending = useRef<number | null>(null);

  // ⌘K / Ctrl+K toggles the palette; "g" then a letter jumps to a section.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!open);
        return;
      }
      if (open || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (goPending.current != null) {
        window.clearTimeout(goPending.current);
        goPending.current = null;
        const section = ALL_SECTIONS.find((s) => s.shortcut === e.key.toLowerCase());
        if (section) {
          e.preventDefault();
          router.push(withFilters(section.href));
        }
        return;
      }
      if (e.key === "g") goPending.current = window.setTimeout(() => (goPending.current = null), GO_TIMEOUT_MS);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen, router, withFilters]);

  // Load the entity index the first time the palette opens, then keep it for the session.
  useEffect(() => {
    if (!open || index || loading) return;
    startLoading(async () => {
      try {
        setIndex(await searchIndex());
        setError(false);
      } catch {
        setError(true);
      }
    });
  }, [open, index, loading]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const filters = parseFilters(params);
  const grouped = ENTITY_ORDER.map((type) => ({ type, items: index?.filter((i) => i.type === type) ?? [] }));
  const otherMode = mode === "pm" ? "leadership" : "pm";

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Jump to a section or search courses, cohorts, people, sessions and issues" className="sm:max-w-xl">
      <Command loop filter={filter}>
        <CommandInput placeholder="Search sections, courses, cohorts, people, issues…" />
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>{loading ? "Loading records…" : "No matches."}</CommandEmpty>

          <CommandGroup heading="Go to">
            {ALL_SECTIONS.map((s) => (
              <CommandItem key={s.id} value={`go ${s.title}`} keywords={[s.description]} onSelect={() => run(() => router.push(withFilters(s.href)))}>
                <s.icon />
                <span>{s.title}</span>
                <CommandShortcut>G {s.shortcut.toUpperCase()}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading="Actions">
            <CommandItem value="toggle theme" keywords={["dark", "light", "appearance"]} onSelect={() => run(() => setTheme(resolvedTheme === "light" ? "dark" : "light"))}>
              {resolvedTheme === "light" ? <Moon /> : <Sun />}
              <span>Switch to {resolvedTheme === "light" ? "dark" : "light"} theme</span>
            </CommandItem>
            <CommandItem value="switch mode" keywords={["pm", "leadership", "view"]} onSelect={() => run(() => setMode(otherMode))}>
              {otherMode === "leadership" ? <Presentation /> : <UserRound />}
              <span>Switch to {MODE_LABELS[otherMode]} view</span>
            </CommandItem>
            {activeFilterCount(filters) > 0 && (
              <CommandItem value="clear filters" keywords={["reset"]} onSelect={() => run(() => {
                const qs = applyFilters(params, EMPTY_FILTERS).toString();
                router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
              })}>
                <FilterX />
                <span>Clear all filters</span>
              </CommandItem>
            )}
          </CommandGroup>

          {loading && !index && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Loading records…
            </div>
          )}
          {error && <div className="px-3 py-2 text-xs text-red-400">Couldn&apos;t load records. Close and reopen to retry.</div>}

          {grouped.map(({ type, items }) =>
            items.length === 0 ? null : (
              <CommandGroup key={type} heading={ENTITY_LABELS[type]}>
                {items.map((i) => (
                  <CommandItem key={`${i.type}:${i.id}`} value={`${i.type}:${i.id} ${i.label}`} keywords={[i.sublabel, ...i.keywords]} onSelect={() => run(() => router.push(withFilters(i.href)))}>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{i.label}</span>
                      <span className="truncate text-[11px] text-muted-foreground">{i.sublabel}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ),
          )}
        </CommandList>
        <div className="flex items-center justify-between border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          <span>{index ? `${index.length} records · ${SECTIONS.length} sections` : " "}</span>
          <span>↑↓ navigate · ↵ open · esc close</span>
        </div>
      </Command>
    </CommandDialog>
  );
}
