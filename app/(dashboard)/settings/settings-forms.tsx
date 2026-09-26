"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROLE_LABELS, ROLES, type Role } from "@/lib/auth/roles";
import type { AccountDeletionPlan, Member, PendingInvite } from "@/lib/data/workspaces";
import {
  changeRoleAction,
  clearDemoDataAction,
  deleteAccountAction,
  deleteWorkspaceAction,
  inviteAction,
  removeMemberAction,
  renameAction,
  revokeInviteAction,
  type ActionResult,
} from "./actions";

const selectClass =
  "h-7 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30";

function Feedback({ result }: { result: ActionResult }) {
  if (result.error) return <p role="alert" className="text-xs text-red-400">{result.error}</p>;
  if (result.message) return <p role="status" className="text-xs text-emerald-400">{result.message}</p>;
  return null;
}

function SubmitButton({ children, variant }: { children: React.ReactNode; variant?: "default" | "outline" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending && <Loader2 className="animate-spin" />}
      {children}
    </Button>
  );
}

/** Runs a one-off server action and keeps its latest result. */
function useAction() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult>({});
  const run = (fn: () => Promise<ActionResult>) => start(async () => setResult(await fn()));
  return { pending, result, run };
}

export function RenameForm({ name, canEdit }: { name: string; canEdit: boolean }) {
  const [state, action] = useActionState(renameAction, {});
  return (
    <form action={action} className="space-y-2">
      <div className="flex gap-2">
        <Input name="name" defaultValue={name} maxLength={60} disabled={!canEdit} aria-label="Workspace name" className="max-w-sm" />
        {canEdit && <SubmitButton variant="outline">Save</SubmitButton>}
      </div>
      <Feedback result={state} />
    </form>
  );
}

function MemberRow({ m, isYou, canManage }: { m: Member; isYou: boolean; canManage: boolean }) {
  const { pending, result, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="space-y-1 py-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">
            {m.name ?? m.email}
            {isYou && <span className="text-muted-foreground"> (you)</span>}
          </p>
          <p className="truncate text-xs text-muted-foreground">{m.email}</p>
        </div>
        {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        {canManage ? (
          <select
            aria-label={`Role for ${m.email}`}
            className={selectClass}
            value={m.role}
            disabled={pending}
            onChange={(e) => run(() => changeRoleAction(m.userId, e.target.value))}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-muted-foreground">{ROLE_LABELS[m.role]}</span>
        )}
        {canManage &&
          (confirming ? (
            <span className="flex items-center gap-1">
              <Button size="xs" variant="destructive" disabled={pending} onClick={() => run(() => removeMemberAction(m.userId))}>
                {isYou ? "Leave" : "Remove"}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
            </span>
          ) : (
            <Button size="icon-xs" variant="ghost" aria-label={`Remove ${m.email}`} onClick={() => setConfirming(true)}>
              <Trash2 />
            </Button>
          ))}
      </div>
      <Feedback result={result} />
    </li>
  );
}

export function MemberList({ members, currentUserId, canManage }: { members: Member[]; currentUserId: string; canManage: boolean }) {
  return (
    <ul className="divide-y rounded-md border px-3">
      {members.map((m) => (
        <MemberRow key={m.userId} m={m} isYou={m.userId === currentUserId} canManage={canManage} />
      ))}
    </ul>
  );
}

export function InviteForm() {
  const [state, action] = useActionState(inviteAction, {});
  const [role, setRole] = useState<Role>("EDITOR");
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Input name="email" type="email" required placeholder="name@company.com" aria-label="Email" className="max-w-xs" />
        <select name="role" aria-label="Role" className={`${selectClass} h-8`} value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
        <SubmitButton>Invite</SubmitButton>
      </div>
      <Feedback result={state} />
    </form>
  );
}

function InviteRow({ invite }: { invite: PendingInvite }) {
  const { pending, result, run } = useAction();
  const expired = new Date(invite.expiresAt) < new Date();
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{invite.email}</p>
        <p className="truncate text-xs text-muted-foreground">
          {ROLE_LABELS[invite.role]} · invited by {invite.invitedBy} ·{" "}
          {expired ? <span className="text-amber-400">expired, re-invite to renew</span> : `expires ${new Date(invite.expiresAt).toISOString().slice(0, 10)}`}
        </p>
        <Feedback result={result} />
      </div>
      <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => revokeInviteAction(invite.id))}>
        <X /> Revoke
      </Button>
    </li>
  );
}

export function InviteList({ invites }: { invites: PendingInvite[] }) {
  if (invites.length === 0) return <p className="text-xs text-muted-foreground">No pending invites.</p>;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">Pending · {invites.length}</p>
      <ul className="divide-y rounded-md border px-3">
        {invites.map((i) => <InviteRow key={i.id} invite={i} />)}
      </ul>
    </div>
  );
}

export function DemoDataPanel({ demoRows, canClear }: { demoRows: number; canClear: boolean }) {
  const { pending, result, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  if (demoRows === 0) {
    return (
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">This workspace has no demo data.</p>
        <Feedback result={result} />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm">
        <span className="font-semibold tabular-nums">{demoRows.toLocaleString()}</span> demo records in this workspace.
      </p>
      {canClear &&
        (confirming ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
            <p className="text-sm text-red-400">Permanently delete {demoRows.toLocaleString()} demo records? This can&apos;t be undone.</p>
            <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(clearDemoDataAction)}>
              {pending && <Loader2 className="animate-spin" />} Delete demo data
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>Clear demo data</Button>
        ))}
      <Feedback result={result} />
    </div>
  );
}

const sameText = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

/** A destructive action that needs `phrase` typed first. The server checks it again. */
function TypedConfirm({
  phrase, label, action, children,
}: {
  phrase: string;
  label: string;
  action: (typed: string) => Promise<ActionResult>;
  children: React.ReactNode;
}) {
  const { pending, result, run } = useAction();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  if (!open) {
    return (
      <Button size="sm" variant="outline" className="text-red-400" onClick={() => setOpen(true)}>
        <Trash2 /> {label}
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-3">
      <div className="text-sm text-red-400">{children}</div>
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Type <span className="font-mono text-foreground">{phrase}</span> to confirm</span>
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} className="max-w-sm" autoFocus autoComplete="off" aria-label={`Type ${phrase} to confirm`} />
      </label>
      <div className="flex gap-2">
        <Button size="sm" variant="destructive" disabled={pending || !sameText(typed, phrase)} onClick={() => run(() => action(typed))}>
          {pending && <Loader2 className="animate-spin" />} {label}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setOpen(false); setTyped(""); }}>Cancel</Button>
      </div>
      <Feedback result={result} />
    </div>
  );
}

export function DeleteWorkspacePanel({ name }: { name: string }) {
  return (
    <TypedConfirm phrase={name} label="Delete workspace" action={deleteWorkspaceAction}>
      Permanently delete <span className="font-medium">{name}</span>, every record in it, its Trash, imports, AI settings and memberships?
      Members lose access right away. This can&apos;t be undone.
    </TypedConfirm>
  );
}

export function DeleteAccountPanel({ email, plan }: { email: string; plan: AccountDeletionPlan }) {
  return (
    <div className="space-y-2">
      <div className="space-y-1 text-xs text-muted-foreground">
        {plan.deletes.length > 0 ? (
          <>
            <p>You&apos;re the only owner of these, so they&apos;re deleted with your account (make someone else an owner first to keep one):</p>
            <ul className="list-disc pl-5 text-foreground">
              {plan.deletes.map((w) => (
                <li key={w.id}>
                  {w.name}
                  {w.otherMembers > 0 && <span className="text-amber-400"> · {w.otherMembers} other member{w.otherMembers === 1 ? "" : "s"} lose access</span>}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>You don&apos;t own any workspace alone, so no workspace is deleted.</p>
        )}
        {plan.leaves.length > 0 && <p>You leave: {plan.leaves.map((w) => w.name).join(", ")}.</p>}
      </div>
      <TypedConfirm phrase={email} label="Delete my account" action={deleteAccountAction}>
        Delete your account ({email}){plan.deletes.length > 0 && ` and ${plan.deletes.length} workspace${plan.deletes.length === 1 ? "" : "s"}`}? Your Google access
        for this app is revoked and you&apos;re signed out. This can&apos;t be undone.
      </TypedConfirm>
    </div>
  );
}
