import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { safeRedirect } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  AccessDenied:
    "That Google account isn't invited. Ask a workspace owner to invite the exact address you signed in with, then try again.",
  Configuration: "Sign-in isn't configured on this server. Check the AUTH_* values in .env.local.",
};

export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  const params = await searchParams;
  const from = safeRedirect(Array.isArray(params.from) ? params.from[0] : params.from);
  if ((await auth())?.user) redirect(from);
  const code = Array.isArray(params.error) ? params.error[0] : params.error;
  const error = code ? (ERRORS[code] ?? "Sign-in failed. Please try again.") : null;

  async function signInWithGoogle() {
    "use server";
    await signIn("google", { redirectTo: from });
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2">
          <div className="flex size-9 items-center justify-center rounded-md border bg-background font-mono text-xs font-semibold">
            CC
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Command Center</h1>
          <p className="text-sm text-muted-foreground">
            Sign in with the Google account your workspace invite was sent to. Access is invite-only.
          </p>
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}
        <form action={signInWithGoogle}>
          <Button type="submit" className="w-full">
            Continue with Google
          </Button>
        </form>
      </div>
    </main>
  );
}
