"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp, FileUp, FilterX, Loader2, Moon, Plus, Presentation, Search, Sun, UserRound } from "lucide-react";
import { useTheme } from "next-themes";
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { ALL_SECTIONS, SECTIONS } from "@/lib/nav";
import { RECORD_TYPES, RECORDS } from "@/lib/records/registry";
import { IMPORT_TYPES } from "@/lib/import/mapping";
import { activeFilterCount, applyFilters, EMPTY_FILTERS, parseFilters } from "@/lib/filters";
import { MODE_LABELS } from "@/lib/mode";
import { GROUP_LIMIT, highlightSegments, matchesAll, parseQuery, searchRecords, suggestQueries } from "@/lib/search";
import type { EntityType, SearchItem } from "@/lib/search-types";
import { searchIndex } from "@/app/(dashboard)/actions";
import { useHrefWithFilters, useMode, useShell } from "@/components/shell/shell-context";

const GO_TIMEOUT_MS = 1200;

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlightSegments(text, terms).map((s, i) =>
        s.match ? (
          <mark key={i} className="rounded-[2px] bg-foreground/15 font-semibold text-foreground">{s.text}</mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

export function CommandPalette() {
  const router = useRouter();
  const { paletteOpen: open, setPaletteOpen: setOpen, canEdit, setQuickAddOpen, searchVersion, quickAddOpen, recordForm } = useShell();
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
      if (open || quickAddOpen || recordForm || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
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
      // "c" alone is Quick add ("g" then "c" is Cohorts, handled above).
      else if (e.key === "c" && canEdit) {
        e.preventDefault();
        setQuickAddOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen, router, withFilters, canEdit, setQuickAddOpen, quickAddOpen, recordForm]);

  // (Re)load the entity index each time the palette opens and after every save; the
  // previous copy stays searchable meanwhile, so new records show up without a wait.
  useEffect(() => {
    if (!open) return;
    startLoading(async () => {
      try {
        setIndex(await searchIndex());
        setError(false);
      } catch {
        setError(true);
      }
    });
  }, [open, searchVersion]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Jump to a section or search courses, modules, projects, sessions, issues, feedback and people" className="sm:max-w-xl">
      {/* The dialog unmounts its content on close, so the query resets each time it opens. */}
      <PaletteContent index={index} loading={loading} error={error} close={() => setOpen(false)} />
    </CommandDialog>
  );
}

function PaletteContent({
  index,
  loading,
  error,
  close,
}: {
  index: SearchItem[] | null;
  loading: boolean;
  error: boolean;
  close: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { mode, setMode } = useMode();
  const { canEdit, openRecordForm, setQuickAddOpen } = useShell();
  const { resolvedTheme, setTheme } = useTheme();
  const withFilters = useHrefWithFilters();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<EntityType | null>(null);

  const terms = parseQuery(query);
  const groups = useMemo(() => searchRecords(index ?? [], query), [index, query]);

  const run = (fn: () => void) => {
    close();
    fn();
  };

  const filters = parseFilters(params);
  const otherMode = mode === "pm" ? "leadership" : "pm";
  const actions = [
    {
      id: "theme", text: `Switch to ${resolvedTheme === "light" ? "dark" : "light"} theme`, keywords: "dark light appearance",
      icon: resolvedTheme === "light" ? Moon : Sun,
      onSelect: () => setTheme(resolvedTheme === "light" ? "dark" : "light"),
    },
    {
      id: "mode", text: `Switch to ${MODE_LABELS[otherMode]} view`, keywords: "pm leadership mode view",
      icon: otherMode === "leadership" ? Presentation : UserRound,
      onSelect: () => setMode(otherMode),
    },
    ...(activeFilterCount(filters) > 0
      ? [{
          id: "clear-filters", text: "Clear all filters", keywords: "reset", icon: FilterX,
          onSelect: () => {
            const qs = applyFilters(params, EMPTY_FILTERS).toString();
            router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
          },
        }]
      : []),
    // Creating records (editors and owners): one Quick add entry until you type, then "New cohort…" etc.
    ...(!canEdit
      ? []
      : terms.length === 0
        ? [{ id: "quick-add", text: "Quick add…", keywords: "new create add", icon: Plus, shortcut: "C", onSelect: () => setQuickAddOpen(true) }]
        : [
            ...RECORD_TYPES.map((t) => ({
              id: `new-${t}`, text: `New ${RECORDS[t].noun}…`, keywords: "add create quick", icon: Plus,
              onSelect: () => openRecordForm(t),
            })),
            ...IMPORT_TYPES.map((t) => ({
              id: `import-${t}`, text: `Import ${RECORDS[t].noun.endsWith("s") ? RECORDS[t].noun : `${RECORDS[t].noun}s`}…`,
              keywords: "csv google sheet upload sync", icon: FileUp,
              onSelect: () => router.push(`/import?type=${t}`),
            })),
          ]),
  ].filter((a) => matchesAll([a.text, a.keywords], terms));
  const sections = ALL_SECTIONS.filter((s) => matchesAll([s.title, s.description], terms));

  const nothingFound = terms.length > 0 && !!index && groups.length === 0 && sections.length === 0 && actions.length === 0;
  const suggestions = nothingFound ? suggestQueries(index, query) : [];

  return (
    <Command loop shouldFilter={false}>
      <CommandInput
        value={query}
        onValueChange={(v) => {
          setQuery(v);
          setExpanded(null);
        }}
        placeholder="Search courses, modules, sessions, issues, feedback, people…"
      />
      <CommandList className="max-h-[60vh]">
        {sections.length > 0 && (
          <CommandGroup heading="Go to">
            {sections.map((s) => (
              <CommandItem key={s.id} value={`go:${s.id}`} onSelect={() => run(() => router.push(withFilters(s.href)))}>
                <s.icon />
                <span><Highlight text={s.title} terms={terms} /></span>
                <CommandShortcut>G {s.shortcut.toUpperCase()}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {actions.length > 0 && (
          <CommandGroup heading="Actions">
            {actions.map((a) => (
              <CommandItem key={a.id} value={`action:${a.id}`} onSelect={() => run(a.onSelect)}>
                <a.icon />
                <span><Highlight text={a.text} terms={terms} /></span>
                {"shortcut" in a && a.shortcut && <CommandShortcut>{a.shortcut}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {loading && !index && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading records…
          </div>
        )}
        {error && <div className="px-3 py-2 text-xs text-red-400">Couldn&apos;t load records. Close and reopen to retry.</div>}

        {groups.map(({ type, label, hits }) => {
          const showAll = expanded === type;
          const shown = showAll ? hits : hits.slice(0, GROUP_LIMIT);
          return (
            <CommandGroup
              key={type}
              heading={<>{label} <span className="tabular-nums text-muted-foreground/70">· {hits.length}</span></>}
            >
              {shown.map(({ item: i, snippet }) => (
                <CommandItem key={`${i.type}:${i.id}`} value={`${i.type}:${i.id}`} onSelect={() => run(() => router.push(withFilters(i.href)))}>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate"><Highlight text={i.label} terms={terms} /></span>
                    <span className="truncate text-[11px] text-muted-foreground"><Highlight text={i.sublabel} terms={terms} /></span>
                    {snippet && (
                      <span className="truncate text-[11px] text-muted-foreground">
                        {snippet.name}: <Highlight text={snippet.text} terms={terms} />
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
              {hits.length > GROUP_LIMIT && (
                <CommandItem
                  value={`see-all:${type}`}
                  onSelect={() => setExpanded(showAll ? null : type)}
                  className="text-xs text-muted-foreground"
                >
                  {showAll ? <ChevronUp /> : <ChevronDown />}
                  {showAll ? `Show top ${GROUP_LIMIT}` : `See all ${hits.length} ${label.toLowerCase()}`}
                </CommandItem>
              )}
            </CommandGroup>
          );
        })}

        {nothingFound && (
          <div className="px-3 pt-5 pb-2 text-center text-sm">
            <p>No results for &ldquo;{query.trim()}&rdquo;.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Search matches the start of words in names, titles, descriptions, tags and feedback. Try fewer
              words, a course or cohort code (AIE, AAI-C2), a person&apos;s name, or a topic.
            </p>
          </div>
        )}
        {suggestions.length > 0 && (
          <CommandGroup heading="Try">
            {suggestions.map((s) => (
              <CommandItem key={s} value={`suggest:${s}`} onSelect={() => setQuery(s)}>
                <Search />
                <span>{s}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <div className="flex items-center justify-between border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>{index ? `${index.length} records · ${SECTIONS.length} sections` : " "}</span>
        <span>↑↓ navigate · ↵ open · esc close</span>
      </div>
    </Command>
  );
}
