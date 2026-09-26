"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, LogOut, Settings, Trash2 } from "lucide-react";
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
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DATA_SECTION, SECTIONS, SETTINGS_SECTION, sectionForPath, type Section } from "@/lib/nav";
import { MODE_LABELS } from "@/lib/mode";
import type { WorkspaceSummary } from "@/lib/auth/access";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { useHrefWithFilters, useMode, useShellLocation } from "@/components/shell/shell-context";
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher";
import { signOutAction } from "@/app/(dashboard)/actions";

export type ShellUser = { name: string | null; email: string; image: string | null };

function NavItem({ section, active }: { section: Section; active: boolean }) {
  const withFilters = useHrefWithFilters();
  const { setOpenMobile } = useSidebar();
  const Icon = section.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={`${section.title}  ·  G ${section.shortcut.toUpperCase()}`}
        // On a phone the sidebar is a sheet: get it out of the way once a section is picked.
        render={<Link href={withFilters(section.href)} onClick={() => setOpenMobile(false)} />}
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
  const router = useRouter();
  const current = sectionForPath(useShellLocation().pathname);
  const workspace = workspaces.find((w) => w.id === currentWorkspaceId);
  const { mode } = useMode();
  const { setOpenMobile } = useSidebar();
  const go = (href: string) => {
    setOpenMobile(false);
    router.push(href);
  };
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
              <DropdownMenuContent className="min-w-60" side="top" align="start">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="space-y-0.5 py-1.5 font-normal">
                    <span className="block truncate text-sm font-medium text-foreground">{user.name ?? user.email}</span>
                    {user.name && <span className="block truncate text-xs">{user.email}</span>}
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {workspace && (
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="flex items-center gap-2 font-normal">
                      <Building2 className="size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-foreground">{workspace.name}</span>
                      <span className="text-[11px]">{ROLE_LABELS[workspace.role]}</span>
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                )}
                <DropdownMenuItem onClick={() => go(SETTINGS_SECTION.href)}>
                  <Settings /> Settings
                </DropdownMenuItem>
                {workspace?.role === "OWNER" && (
                  <DropdownMenuItem onClick={() => go("/settings/trash")}>
                    <Trash2 /> Trash
                  </DropdownMenuItem>
                )}
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
