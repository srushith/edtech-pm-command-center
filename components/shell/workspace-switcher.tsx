"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Check, ChevronsUpDown, Loader2, Plus, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { ROLE_LABELS } from "@/lib/auth/roles";
import type { WorkspaceSummary } from "@/lib/auth/access";
import { switchWorkspace } from "@/app/(dashboard)/actions";

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "W";
}

export function WorkspaceSwitcher({ workspaces, currentId }: { workspaces: WorkspaceSummary[]; currentId: string }) {
  const [pending, startSwitch] = useTransition();
  const { setOpenMobile } = useSidebar();
  const current = workspaces.find((w) => w.id === currentId) ?? workspaces[0];

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent" />}
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background font-mono text-xs font-semibold">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : initials(current.name)}
            </div>
            <div className="grid flex-1 text-left leading-tight">
              <span className="truncate text-sm font-semibold">{current.name}</span>
              <span className="truncate text-xs text-muted-foreground">{ROLE_LABELS[current.role]}</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-60" align="start" side="bottom">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              {workspaces.map((w) => (
                <DropdownMenuItem
                  key={w.id}
                  disabled={pending}
                  onClick={() => w.id !== current.id && startSwitch(() => switchWorkspace(w.id))}
                >
                  <span className="truncate">{w.name}</span>
                  <span className="ml-auto pl-3 text-[11px] text-muted-foreground">{ROLE_LABELS[w.role]}</span>
                  <Check className={w.id === current.id ? "size-3.5" : "size-3.5 invisible"} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/onboarding?new=1" />}>
              <Plus /> New workspace
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/settings" onClick={() => setOpenMobile(false)} />}>
              <Settings /> Workspace settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
