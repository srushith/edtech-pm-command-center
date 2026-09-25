import { Suspense } from "react";
import { cookies } from "next/headers";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { CommandPalette } from "@/components/shell/command-palette";
import { ShellProvider } from "@/components/shell/shell-context";
import { TopBar } from "@/components/shell/top-bar";
import { QuickAdd } from "@/components/records/quick-add";
import { RecordSheet } from "@/components/records/record-sheet";
import { hasRole } from "@/lib/auth/roles";
import { listWorkspaces } from "@/lib/auth/access";
import { requireUser, requireWorkspace } from "@/lib/auth/session";
import { getFilterOptions } from "@/lib/data/filters";
import { getModeCookie } from "@/lib/mode-server";

// Every dashboard page requires a signed-in member of the current workspace
// (proxy.ts only does an optimistic cookie check).
export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const [user, ctx] = await Promise.all([requireUser(), requireWorkspace()]);
  const [filterOptions, workspaces, mode, cookieStore] = await Promise.all([
    getFilterOptions(ctx), listWorkspaces(user.id), getModeCookie(), cookies(),
  ]);
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <ShellProvider initialMode={mode ?? "pm"} canEdit={hasRole(ctx.role, "EDITOR")}>
      <SidebarProvider defaultOpen={sidebarOpen}>
        {/* The shell reads search params for filters and the ?mode override. */}
        <Suspense>
          <AppSidebar user={user} workspaces={workspaces} currentWorkspaceId={ctx.workspace.id} />
        </Suspense>
        <SidebarInset>
          <Suspense>
            <TopBar filterOptions={filterOptions} />
          </Suspense>
          <div className="flex-1">{children}</div>
        </SidebarInset>
        <Suspense>
          <CommandPalette />
        </Suspense>
        <RecordSheet />
        <QuickAdd />
      </SidebarProvider>
    </ShellProvider>
  );
}
