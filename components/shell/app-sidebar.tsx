"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DATA_SECTION, SECTIONS, SETTINGS_SECTION, sectionForPath, type Section } from "@/lib/nav";
import { MODE_LABELS } from "@/lib/mode";
import type { WorkspaceSummary } from "@/lib/auth/access";
import { useHrefWithFilters, useMode } from "@/components/shell/shell-context";
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher";
import { signOutAction } from "@/app/(dashboard)/actions";

export type ShellUser = { name: string | null; email: string; image: string | null };

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

export function AppSidebar({
  user,
  workspaces,
  currentWorkspaceId,
}: {
  user: ShellUser;
  workspaces: WorkspaceSummary[];
  currentWorkspaceId: string;
}) {
  const pathname = usePathname();
  const current = sectionForPath(pathname);
  const { mode } = useMode();
  const displayName = user.name ?? user.email;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <WorkspaceSwitcher workspaces={workspaces} currentId={currentWorkspaceId} />
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
          <NavItem section={SETTINGS_SECTION} active={current?.id === SETTINGS_SECTION.id} />
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" tooltip={displayName} />}>
                <div className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full border text-[11px] font-medium">
                  {user.image ? (
                    // Google avatar; a plain img avoids configuring remote image domains.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.image} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    displayName[0]?.toUpperCase()
                  )}
                </div>
                <div className="grid flex-1 leading-tight">
                  <span className="truncate text-xs font-medium">{displayName}</span>
                  <span className="truncate text-[11px] text-muted-foreground">{MODE_LABELS[mode]} view</span>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-56" side="top" align="start">
                <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOutAction()}>
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
