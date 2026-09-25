import { Suspense } from "react";
import { cookies } from "next/headers";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { CommandPalette } from "@/components/shell/command-palette";
import { ShellProvider } from "@/components/shell/shell-context";
import { TopBar } from "@/components/shell/top-bar";
import { getFilterOptions } from "@/lib/data/filters";
import { getModeCookie } from "@/lib/mode-server";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const [filterOptions, mode, cookieStore] = await Promise.all([getFilterOptions(), getModeCookie(), cookies()]);
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <ShellProvider initialMode={mode ?? "pm"}>
      <SidebarProvider defaultOpen={sidebarOpen}>
        {/* The shell reads search params for filters and the ?mode override. */}
        <Suspense>
          <AppSidebar />
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
      </SidebarProvider>
    </ShellProvider>
  );
}
