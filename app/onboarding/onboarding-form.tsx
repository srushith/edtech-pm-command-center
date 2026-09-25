"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Database, FileX2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { createWorkspaceAction, type OnboardingState } from "./actions";

const STARTS = [
  {
    id: "demo",
    icon: Database,
    title: "Start with demo data",
    detail: "8 courses, 10 cohorts, sessions, feedback, issues and launches. Clear it any time in Settings.",
  },
  {
    id: "empty",
    icon: FileX2,
    title: "Start empty",
    detail: "No records. Add your own courses and cohorts as later phases ship.",
  },
] as const;

function Submit({ start }: { start: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending && <Loader2 className="animate-spin" />}
      {pending ? (start === "demo" ? "Creating workspace and demo data…" : "Creating workspace…") : "Create workspace"}
    </Button>
  );
}

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const [state, action] = useActionState<OnboardingState, FormData>(createWorkspaceAction, {});
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState(defaultName);
  const [start, setStart] = useState<"demo" | "empty">("demo");

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="start" value={start} />
      <p className="text-xs text-muted-foreground tabular-nums">Step {step} of 2</p>

      {step === 1 ? (
        <div className="space-y-3">
          <label htmlFor="ws-name" className="text-sm font-medium">Name your workspace</label>
          <Input
            id="ws-name"
            autoFocus
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (name.trim()) setStep(2);
              }
            }}
            placeholder="e.g. AI Programs"
          />
          <p className="text-xs text-muted-foreground">Usually the portfolio you manage. You can rename it later.</p>
          <Button type="button" className="w-full" disabled={!name.trim()} onClick={() => setStep(2)}>
            Continue
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-medium">How do you want to start “{name.trim()}”?</p>
          <div className="grid gap-2" role="radiogroup" aria-label="Starting data">
            {STARTS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={start === s.id}
                onClick={() => setStart(s.id)}
                className={cn(
                  "flex gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
                  start === s.id ? "border-foreground/40 bg-muted" : "hover:bg-muted/50",
                )}
              >
                <s.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block text-sm font-medium">{s.title}</span>
                  <span className="block text-xs text-muted-foreground">{s.detail}</span>
                </span>
              </button>
            ))}
          </div>
          {state.error && <p role="alert" className="text-sm text-red-400">{state.error}</p>}
          <Submit start={start} />
          <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => setStep(1)}>
            Back
          </Button>
        </div>
      )}
    </form>
  );
}
