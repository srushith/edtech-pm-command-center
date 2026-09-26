"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { AIModeChip as ModeChip } from "@/components/ai-mode-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AISettingsView } from "@/lib/data/ai-settings";
import { removeAIKeyAction, saveAISettingsAction, testAIKeyAction, type ActionResult } from "./actions";

const PROVIDERS = [
  { value: "OPENAI", label: "OpenAI" },
  { value: "GEMINI", label: "Gemini" },
  { value: "ANTHROPIC", label: "Anthropic" },
] as const;

const FEATURE_LABELS: Record<string, string> = {
  "import.column-mapping": "Import column mapping",
  "settings.test-key": "Test key",
};

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
const n = (x: number) => x.toLocaleString();

function Feedback({ result }: { result: ActionResult }) {
  if (result.error) return <p role="alert" className="text-xs text-red-400">{result.error}</p>;
  if (result.message) return <p role="status" className="text-xs text-emerald-400">{result.message}</p>;
  return null;
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending && <Loader2 className="animate-spin" />} Save
    </Button>
  );
}

function Usage({ view }: { view: AISettingsView }) {
  const u = view.usage;
  const limit = view.monthlyRequestLimit;
  const pct = limit ? Math.min(100, Math.round((u.thisMonth.billable / limit) * 100)) : null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Usage this month (UTC)</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Requests", limit ? `${n(u.thisMonth.billable)} / ${n(limit)}` : n(u.thisMonth.billable)],
          ["Input tokens", n(u.thisMonth.inputTokens)],
          ["Output tokens", n(u.thisMonth.outputTokens)],
          ["Errors · tests", `${n(u.thisMonth.errors)} · ${n(u.thisMonth.tests)}`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-md border px-3 py-2">
            <p className="text-[11px] text-muted-foreground">{k}</p>
            <p className="text-sm font-medium tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      {pct != null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-label={`${pct}% of the monthly limit used`}>
          <div className={cn("h-full", pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${pct}%` }} />
        </div>
      )}
      {u.byFeature.length > 0 && (
        <ul className="text-xs text-muted-foreground">
          {u.byFeature.map((f) => (
            <li key={f.feature}>{FEATURE_LABELS[f.feature] ?? f.feature}: {n(f.requests)} request{f.requests === 1 ? "" : "s"}, {n(f.tokens)} tokens</li>
          ))}
        </ul>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead className="text-muted-foreground">
            <tr><th className="text-left font-medium">Month</th><th className="text-right font-medium">Requests</th><th className="text-right font-medium">Tokens in</th><th className="text-right font-medium">Tokens out</th></tr>
          </thead>
          <tbody>
            {[...u.history].reverse().map((m) => (
              <tr key={m.month}><td>{m.month}</td><td className="text-right">{n(m.requests)}</td><td className="text-right">{n(m.inputTokens)}</td><td className="text-right">{n(m.outputTokens)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">Counts real-provider requests (the mock is free and not counted). Key tests are logged but don&apos;t count toward the limit.</p>
    </div>
  );
}

export function AISettingsPanel({ view, encryptionHelp }: { view: AISettingsView; encryptionHelp: string }) {
  const [provider, setProvider] = useState<string>(view.provider);
  const [model, setModel] = useState(view.model);
  const [apiKey, setApiKey] = useState("");
  // Clear the typed key once it's saved: it lives only on the server from then on.
  const [state, action] = useActionState(async (prev: ActionResult, form: FormData) => {
    const r = await saveAISettingsAction(prev, form);
    if (!r.error) setApiKey("");
    return r;
  }, {});
  const [testing, startTest] = useTransition();
  const [testResult, setTestResult] = useState<ActionResult>({});
  const [removing, startRemove] = useTransition();
  const [removeResult, setRemoveResult] = useState<ActionResult>({});
  const [confirmRemove, setConfirmRemove] = useState(false);
  const keyIsSavedFor = view.hasKey && provider === view.provider;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <ModeChip label={view.modeLabel} kind={view.mode.kind} />
        <p className="text-xs text-muted-foreground">{view.modeDetail}</p>
      </div>

      {!view.encryptionReady && (
        <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          The server has no ENCRYPTION_KEY, so API keys can&apos;t be saved or used. {encryptionHelp}
        </p>
      )}

      {view.canEdit ? (
        <form action={action} className="space-y-3" autoComplete="off">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="ai-provider" className="text-xs font-medium">Provider</label>
              <select
                id="ai-provider"
                name="provider"
                className={selectClass}
                value={provider}
                onChange={(e) => {
                  // Swap the default model along with the provider, unless a custom one was typed.
                  if (model === view.defaults[provider as keyof typeof view.defaults] || !model) setModel(view.defaults[e.target.value as keyof typeof view.defaults]);
                  setProvider(e.target.value);
                }}
              >
                {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="ai-model" className="text-xs font-medium">Model</label>
              <Input id="ai-model" name="model" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
            </div>
            <div className="space-y-1">
              <label htmlFor="ai-key" className="text-xs font-medium">API key</label>
              <Input
                id="ai-key"
                name="apiKey"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={keyIsSavedFor ? `Saved ${view.keyMasked ?? ""}. Leave blank to keep it.` : "Paste the API key"}
              />
              <p className="text-[11px] text-muted-foreground">Encrypted on the server; never shown again or sent to anyone&apos;s browser.</p>
            </div>
            <div className="space-y-1">
              <label htmlFor="ai-limit" className="text-xs font-medium">Monthly request limit</label>
              <Input id="ai-limit" name="monthlyRequestLimit" type="number" min={1} defaultValue={view.monthlyRequestLimit ?? ""} placeholder="No limit" />
              <p className="text-[11px] text-muted-foreground">When reached, AI is off until the 1st (UTC); features fall back to manual.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SaveButton />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={testing || (!apiKey && !keyIsSavedFor)}
              onClick={() => startTest(async () => setTestResult(await testAIKeyAction({ provider, model, apiKey })))}
            >
              {testing && <Loader2 className="animate-spin" />} Test key
            </Button>
            {view.hasKey &&
              (confirmRemove ? (
                <span className="flex items-center gap-1">
                  <Button type="button" size="sm" variant="destructive" disabled={removing} onClick={() => startRemove(async () => {
                    setRemoveResult(await removeAIKeyAction());
                    setConfirmRemove(false);
                  })}>
                    Remove key
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>Cancel</Button>
                </span>
              ) : (
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemove(true)}>Remove key…</Button>
              ))}
          </div>
          <Feedback result={state} />
          <Feedback result={testResult} />
          <Feedback result={removeResult} />
          {view.lastTest && !testResult.message && !testResult.error && (
            <p className="text-[11px] text-muted-foreground">
              Last test {view.lastTest.at.toISOString().slice(0, 16).replace("T", " ")} UTC: {view.lastTest.ok ? "passed" : `failed. ${view.lastTest.message ?? ""}`}
            </p>
          )}
        </form>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground">Provider</dt><dd>{PROVIDERS.find((p) => p.value === view.provider)?.label}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Model</dt><dd className="truncate">{view.hasKey ? view.model : "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Key</dt><dd>{view.hasKey ? "Set by an owner" : "None (mock)"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Monthly limit</dt><dd>{view.monthlyRequestLimit ? n(view.monthlyRequestLimit) : "None"}</dd></div>
        </dl>
      )}

      <p className="text-[11px] text-muted-foreground">
        What&apos;s sent: import column mapping sends column headers and up to 3 sample values per column to the provider, billed to this workspace&apos;s key.
        {view.updatedBy && ` Last changed by ${view.updatedBy}.`}
      </p>

      <Usage view={view} />
    </div>
  );
}
