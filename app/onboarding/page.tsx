import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listWorkspaces } from "@/lib/auth/access";
import { requireUser } from "@/lib/auth/session";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Create a workspace" };

// First sign-in (no workspaces yet), or "New workspace" from the switcher (?new=1).
export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const user = await requireUser();
  const workspaces = await listWorkspaces(user.id);
  const adding = (await searchParams).new === "1";
  if (workspaces.length > 0 && !adding) redirect("/");
  const first = user.name?.split(" ")[0];

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight">
            {adding ? "New workspace" : `Welcome${first ? `, ${first}` : ""}`}
          </h1>
          <p className="text-sm text-muted-foreground">
            A workspace holds your courses, cohorts, people and issues. Only its members can see it.
          </p>
        </div>
        <OnboardingForm defaultName={adding ? "" : `${first ?? "My"}'s programs`} />
        {adding && (
          <Link href="/" className="block text-center text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </Link>
        )}
      </div>
    </main>
  );
}
