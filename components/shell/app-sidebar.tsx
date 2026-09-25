"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { DATA_SECTION, SECTIONS, sectionForPath, type Section } from "@/lib/nav";
import { MODE_LABELS } from "@/lib/mode";
import { useHrefWithFilters, useMode } from "@/components/shell/shell-context";

function NavItem({ section, active }: { section: Section; active: boolean }) {
  const withFilters = useHrefWithFilters();
  const Icon = section.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={`${section.title}  ·  G ${section.shortcut.toUpperCase()}`}
        render={<Link href={withFilters(section.href)} />}
      >
        <Icon />
        <span>{section.title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const current = sectionForPath(pathname);
  const { mode } = useMode();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background font-mono text-xs font-semibold">
                CC
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-semibold">Command Center</span>
                <span className="truncate text-xs text-muted-foreground">EdTech PM</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {SECTIONS.map((s) => (
                <NavItem key={s.id} section={s} active={current?.id === s.id} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <NavItem section={DATA_SECTION} active={current?.id === DATA_SECTION.id} />
          <SidebarMenuItem>
            <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:px-0">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium">
                S
              </div>
              <div className="grid flex-1 leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate text-xs font-medium">Srushith</span>
                <span className="truncate text-[11px] text-muted-foreground">{MODE_LABELS[mode]} view</span>
              </div>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
