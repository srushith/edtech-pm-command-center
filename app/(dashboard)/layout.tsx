import { Suspense } from "react";
import { cookies, headers } from "next/headers";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { CommandPalette } from "@/components/shell/command-palette";
import { ShellProvider } from "@/components/shell/shell-context";
import { TopBar } from "@/components/shell/top-bar";
import { QuickAdd } from "@/components/records/quick-add";
import { RecordSheet } from "@/components/records/record-sheet";
import { DeleteDialog } from "@/components/records/delete-dialog";
import { hasRole } from "@/lib/auth/roles";
import { describeAIMode, getAIMode } from "@/lib/ai/provider";
import { listWorkspaces } from "@/lib/auth/access";
import { requireUser, requireWorkspace } from "@/lib/auth/session";
import { getFilterOptions } from "@/lib/data/filters";
import { getModeCookie } from "@/lib/mode-server";
import { REQUEST_URL_HEADER } from "@/lib/request-url";

// Every dashboard page requires a signed-in member of the current workspace
// (proxy.ts only does an optimistic cookie check).
export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const [user, ctx] = await Promise.all([requireUser(), requireWorkspace()]);
  const [filterOptions, workspaces, mode, cookieStore, headerStore, aiMode] = await Promise.all([
    getFilterOptions(ctx), listWorkspaces(user.id), getModeCookie(), cookies(), headers(), getAIMode(ctx),
  ]);
  const ai = { ...describeAIMode(aiMode), kind: aiMode.kind, canConfigure: ctx.role === "OWNER" };
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <ShellProvider
      initialMode={mode ?? "pm"}
      canEdit={hasRole(ctx.role, "EDITOR")}
      serverUrl={headerStore.get(REQUEST_URL_HEADER)}
    >
      <SidebarProvider defaultOpen={sidebarOpen}>
        {/* The shell reads the address (section, filters, ?mode) through useShellLocation. */}
        <Suspense>
          <AppSidebar user={user} workspaces={workspaces} currentWorkspaceId={ctx.workspace.id} />
        </Suspense>
        <SidebarInset>
          <Suspense>
            <TopBar filterOptions={filterOptions} ai={ai} />
          </Suspense>
          <div className="flex-1">{children}</div>
        </SidebarInset>
        <Suspense>
          <CommandPalette />
        </Suspense>
        <RecordSheet />
        <DeleteDialog />
        <QuickAdd />
      </SidebarProvider>
    </ShellProvider>
  );
}
