"use client";

import { Command, CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList, CommandEmpty } from "@/components/ui/command";
import { useShell } from "@/components/shell/shell-context";
import { sectionById } from "@/lib/nav";
import { RECORD_SECTION, RECORD_TYPES, RECORDS } from "@/lib/records/registry";

/** Quick add (C): pick a record type, then its form opens. Editors and owners only. */
export function QuickAdd() {
  const { quickAddOpen, setQuickAddOpen, openRecordForm, canEdit } = useShell();
  if (!canEdit) return null;
  return (
    <CommandDialog open={quickAddOpen} onOpenChange={setQuickAddOpen} title="Quick add" description="Choose what to add" className="sm:max-w-sm">
      <Command loop>
        <CommandInput placeholder="Add a…" />
        <CommandList>
          <CommandEmpty>No such record type.</CommandEmpty>
          <CommandGroup heading="Quick add">
            {RECORD_TYPES.map((t) => {
              const Icon = sectionById(RECORD_SECTION[t]).icon;
              const noun = RECORDS[t].noun;
              return (
                <CommandItem key={t} value={noun} onSelect={() => openRecordForm(t)}>
                  <Icon />
                  <span>{noun[0].toUpperCase() + noun.slice(1)}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
