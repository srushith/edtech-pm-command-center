"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { AIModeChip } from "@/components/ai-mode-chip";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { FilterBar } from "@/components/shell/filter-bar";
import { ModeToggle } from "@/components/shell/mode-toggle";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { useShell, useShellLocation } from "@/components/shell/shell-context";
import { sectionForPath } from "@/lib/nav";
import type { FilterOptions } from "@/lib/data/filters";

export type TopBarAI = { label: string; detail: string; kind: string; canConfigure: boolean };

export function TopBar({ filterOptions, ai }: { filterOptions: FilterOptions; ai: TopBarAI }) {
  const section = sectionForPath(useShellLocation().pathname);
  const { setPaletteOpen } = useShell();

  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
      <div className="flex h-11 items-center gap-2 px-3">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-1 h-4 data-vertical:self-center" />
        <h1 className="truncate text-sm font-medium">{section?.title ?? "Command Center"}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="w-44 justify-start text-xs font-normal text-muted-foreground max-sm:w-auto"
            onClick={() => setPaletteOpen(true)}
          >
            <Search />
            <span className="max-sm:hidden">Search…</span>
            <Kbd className="ml-auto max-sm:hidden">⌘K</Kbd>
          </Button>
          {ai.canConfigure ? (
            <Link href="/settings#ai" title={ai.detail} aria-label={`${ai.label}. ${ai.detail}`} className="max-sm:hidden">
              <AIModeChip label={ai.label} kind={ai.kind} />
            </Link>
          ) : (
            <span title={ai.detail} aria-label={`${ai.label}. ${ai.detail}`} className="max-sm:hidden">
              <AIModeChip label={ai.label} kind={ai.kind} />
            </span>
          )}
          <ModeToggle />
          <ThemeToggle />
        </div>
      </div>
      <div className="border-t px-3 py-1.5">
        <FilterBar options={filterOptions} />
      </div>
    </header>
  );
}
