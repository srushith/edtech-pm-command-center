"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { makeLookup, refOptions, type Field, type FieldErrors, type FormOptions, type Values } from "@/lib/records/kit";
import { RECORDS } from "@/lib/records/registry";
import type { EntityType } from "@/lib/search-types";
import type { SaveResult } from "@/lib/data/records";
import { saveRecordAction } from "@/app/(dashboard)/records/actions";

const selectClass =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30";

// datetime-local works in the browser's time zone; the form stores and sends ISO (UTC).
function toLocalInput(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(local: string) {
  if (!local) return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? local : d.toISOString();
}

/** Values actually submitted: hidden and locked fields send "" so the server decides. */
function submittedValues(type: EntityType, values: Values, options: FormOptions): Values {
  const out: Values = {};
  for (const f of RECORDS[type].fields) {
    const hidden = f.showIf && !f.showIf(values, options);
    const locked = f.lockedIf?.(values, options);
    out[f.name] = hidden || locked ? "" : (values[f.name] ?? "");
  }
  return out;
}

/** The same schema and consistency checks the server runs, against the options we loaded. */
function validate(type: EntityType, values: Values, options: FormOptions, existing: Values | null): FieldErrors {
  const def = RECORDS[type];
  const parsed = def.schema.safeParse(submittedValues(type, values, options));
  if (!parsed.success) {
    const errors: FieldErrors = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0] ?? "_form")] ??= issue.message;
    return errors;
  }
  return def.checks?.(parsed.data, { lookup: makeLookup(options), now: new Date(), existing: existing ?? undefined }) ?? {};
}

export function RecordForm({
  type,
  id,
  initial,
  existing,
  options,
  onSaved,
  onCancel,
}: {
  type: EntityType;
  id: string | null;
  initial: Values;
  existing: Values | null;
  options: FormOptions;
  onSaved: (r: Extract<SaveResult, { ok: true }>) => void;
  onCancel: () => void;
}) {
  const def = RECORDS[type];
  const [values, setValues] = useState<Values>(initial);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [saving, startSaving] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const clientErrors = useMemo(() => validate(type, values, options, existing), [type, values, options, existing]);
  const shown = (name: string) =>
    serverErrors[name] ?? ((attempted || touched.has(name)) && clientErrors[name] ? clientErrors[name] : undefined);

  const set = (name: string, value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    setServerErrors(({ [name]: _gone, _form: _f, ...rest }) => rest);
  };
  const touch = (name: string) => setTouched((t) => new Set(t).add(name));

  const submit = () => {
    setAttempted(true);
    if (Object.keys(clientErrors).length) {
      const first = def.fields.find((f) => clientErrors[f.name]);
      formRef.current?.querySelector<HTMLElement>(`[name="${first?.name}"]`)?.focus();
      return;
    }
    startSaving(async () => {
      const r = await saveRecordAction(type, id, submittedValues(type, values, options));
      if (r.ok) onSaved(r);
      else setServerErrors(r.errors);
    });
  };

  const formError = serverErrors._form ?? (attempted ? clientErrors._form : undefined);

  return (
    <form
      ref={formRef}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submit();
        }
      }}
    >
      <div className="grid flex-1 grid-cols-2 content-start gap-x-3 gap-y-3 overflow-y-auto px-4 pb-4">
        {def.fields.map((f) =>
          f.showIf && !f.showIf(values, options) ? null : (
            <FieldRow
              key={f.name}
              field={f}
              values={values}
              options={options}
              error={shown(f.name)}
              onChange={(v) => set(f.name, v)}
              onBlur={() => touch(f.name)}
            />
          ),
        )}
      </div>
      <div className="flex items-center gap-2 border-t px-4 py-3">
        {formError && <p role="alert" className="mr-auto text-xs text-red-400">{formError}</p>}
        {!formError && attempted && Object.keys(clientErrors).length > 0 && (
          <p className="mr-auto text-xs text-red-400">Fix the highlighted fields.</p>
        )}
        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          {id ? "Save changes" : `Add ${def.noun}`}
          <Kbd className="ml-1 max-sm:hidden">Ctrl ↵</Kbd>
        </Button>
      </div>
    </form>
  );
}

function FieldRow({
  field: f,
  values,
  options,
  error,
  onChange,
  onBlur,
}: {
  field: Field;
  values: Values;
  options: FormOptions;
  error?: string;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  const inputId = `rf-${f.name}`;
  const hint = typeof f.hint === "function" ? f.hint(values, options) : f.hint;
  const locked = f.lockedIf?.(values, options) ?? null;
  const value = values[f.name] ?? "";
  const common = {
    id: inputId,
    name: f.name,
    "aria-invalid": !!error || undefined,
    "aria-describedby": `${inputId}-msg`,
    onBlur,
  };

  let control: React.ReactNode;
  if (locked) {
    control = (
      <div className="flex h-8 items-center gap-2 rounded-lg border border-dashed px-2.5 text-sm text-muted-foreground">
        <Lock className="size-3.5" /> {value || "—"}
      </div>
    );
  } else if (f.kind === "textarea") {
    control = <Textarea {...common} rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} />;
  } else if (f.kind === "select" || f.kind === "ref") {
    let opts = f.kind === "ref" && f.ref ? refOptions(f.ref, options) : [...(f.options ?? [])];
    if (f.refFilter) opts = opts.filter((o) => o.value === value || f.refFilter!(o.value, values, options));
    control = (
      <select {...common} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{f.required ? "Choose…" : "None"}</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  } else if (f.kind === "datetime") {
    control = <Input {...common} type="datetime-local" value={toLocalInput(value)} onChange={(e) => onChange(fromLocalInput(e.target.value))} />;
  } else {
    control = (
      <Input
        {...common}
        type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"}
        inputMode={f.kind === "number" ? "decimal" : undefined}
        step={f.step}
        value={value}
        placeholder={f.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", f.wide || f.kind === "textarea" ? "col-span-2" : "col-span-2 sm:col-span-1")}>
      <label htmlFor={inputId} className="text-xs font-medium">
        {f.label}
        {f.required && !locked && <span className="text-muted-foreground"> *</span>}
      </label>
      {control}
      <p id={`${inputId}-msg`} className={cn("text-[11px] leading-snug", error ? "text-red-400" : "text-muted-foreground")}>
        {error ?? locked ?? hint ?? ""}
      </p>
    </div>
  );
}
