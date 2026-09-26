import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/lib/auth/session";
import { listTrash, TRASH_DAYS } from "@/lib/data/trash";
import { TrashList } from "./trash-list";

export const metadata: Metadata = { title: "Trash" };

export default async function TrashPage() {
  const ctx = await requireWorkspace();
  const isOwner = ctx.role === "OWNER";
  const items = isOwner ? await listTrash(ctx) : [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-1">
        <Link href="/settings" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" /> Settings
        </Link>
        <h2 className="text-xl font-semibold tracking-tight">Trash</h2>
        <p className="text-sm text-muted-foreground">
          Deleted records stay here for {TRASH_DAYS} days, hidden from every page, search, count and AI feature, then they&apos;re deleted for good.
          Restoring brings back everything that was deleted with them.
        </p>
      </header>
      {isOwner ? (
        <TrashList items={items} />
      ) : (
        <p className="rounded-md border px-4 py-3 text-sm text-muted-foreground">
          Only owners can restore from or empty the Trash. Right after you delete something, use Undo in the message that appears (it works for 2 minutes).
        </p>
      )}
    </div>
  );
}
