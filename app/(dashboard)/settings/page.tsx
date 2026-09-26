import type { Metadata } from "next";
import { StatusBadge } from "@/components/status-badge";
import { requireWorkspace } from "@/lib/auth/session";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES } from "@/lib/auth/roles";
import Link from "next/link";
import { ChevronRight, Trash2 } from "lucide-react";
import { getWorkspaceSettings, planAccountDeletion } from "@/lib/data/workspaces";
import { countTrash, TRASH_DAYS } from "@/lib/data/trash";
import { getAISettingsView } from "@/lib/data/ai-settings";
import { ENCRYPTION_KEY_HELP } from "@/lib/crypto";
import { AISettingsPanel } from "./ai-settings-panel";
import { DeleteAccountPanel, DeleteWorkspacePanel, DemoDataPanel, InviteForm, InviteList, MemberList, RenameForm } from "./settings-forms";

export const metadata: Metadata = { title: "Settings" };

function Section({ id, title, description, children }: { id?: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3 border-t pt-6 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export default async function SettingsPage() {
  const ctx = await requireWorkspace();
  const [s, ai, trashCount, accountPlan] = await Promise.all([
    getWorkspaceSettings(ctx), getAISettingsView(ctx), countTrash(ctx), planAccountDeletion(ctx.user.id),
  ]);
  const isOwner = s.role === "OWNER";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight">Settings</h2>
          <StatusBadge status="info">{ROLE_LABELS[s.role]}</StatusBadge>
        </div>
        <p className="text-sm text-muted-foreground">
          {isOwner
            ? "You own this workspace: you can rename it, manage members and clear demo data."
            : `You're ${s.role === "EDITOR" ? "an editor" : "a viewer"} here. Only owners can change these settings.`}
        </p>
      </header>

      <Section title="Workspace name">
        <RenameForm name={s.workspace.name} canEdit={isOwner} />
      </Section>

      <Section
        title={`Members · ${s.members.length}`}
        description={ROLES.map((r) => `${ROLE_LABELS[r]}: ${ROLE_DESCRIPTIONS[r].toLowerCase()}`).join(" · ")}
      >
        <MemberList members={s.members} currentUserId={ctx.user.id} canManage={isOwner} />
      </Section>

      {isOwner && (
        <Section
          title="Invite by email"
          description="They sign in with Google using this exact address and join with the role you pick. Invites expire after 14 days. No email is sent."
        >
          <InviteForm />
          <InviteList invites={s.invites} />
        </Section>
      )}

      <Section
        id="ai"
        title="AI"
        description={isOwner
          ? "Use your own OpenAI, Gemini or Anthropic key for AI features in this workspace. Without a key, a built-in mock is used."
          : "AI settings are managed by owners."}
      >
        <AISettingsPanel view={ai} encryptionHelp={ENCRYPTION_KEY_HELP} />
      </Section>

      <Section
        title="Demo data"
        description="Records created by “Start with demo data”. Clearing also removes anything you attached to a demo record."
      >
        <DemoDataPanel demoRows={s.demoRows} canClear={isOwner} />
      </Section>

      <Section
        id="trash"
        title="Trash"
        description={`Deleted records stay for ${TRASH_DAYS} days. Editors can delete (and undo right after); only owners restore or empty the Trash.`}
      >
        {isOwner ? (
          <Link href="/settings/trash" className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
            <Trash2 className="size-4 text-muted-foreground" />
            Open Trash
            <span className="text-muted-foreground tabular-nums">· {trashCount} item{trashCount === 1 ? "" : "s"}</span>
            <ChevronRight className="ml-auto size-4 text-muted-foreground" />
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">{trashCount} item{trashCount === 1 ? "" : "s"} in Trash. Ask an owner to restore something.</p>
        )}
      </Section>

      {isOwner && (
        <Section id="delete-workspace" title="Delete workspace" description="Permanently deletes this workspace and all of its data for every member.">
          <DeleteWorkspacePanel name={s.workspace.name} />
        </Section>
      )}

      <Section id="delete-account" title="Delete your account" description={`Signed in as ${ctx.user.email}.`}>
        <DeleteAccountPanel email={ctx.user.email} plan={accountPlan} />
      </Section>
    </div>
  );
}
