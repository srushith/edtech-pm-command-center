import type { Metadata } from "next";
import { StatusBadge } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireWorkspace } from "@/lib/auth/session";
import { getRecordCounts, runIntegrityChecks } from "@/lib/data/integrity";
import { DEMO_TODAY } from "@/lib/domain/time";

export const metadata: Metadata = { title: "Data integrity" };

const EVIDENCE_LIMIT = 3;

export default async function DataPage() {
  const ctx = await requireWorkspace();
  const [counts, checks] = await Promise.all([getRecordCounts(ctx), runIntegrityChecks(ctx)]);
  const passing = checks.filter((c) => c.passed).length;
  const allPass = passing === checks.length;
  const totalRecords = counts.reduce((sum, c) => sum + c.count, 0);
  const belowTarget = counts.filter((c) => c.target != null && c.count < c.target);
  const hasDemo = counts.some((c) => c.target != null); // targets only apply to demo data
  const anchor = DEMO_TODAY.toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:px-6">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Data integrity</h2>
        <p className="text-sm text-muted-foreground">
          {ctx.workspace.name}
          {hasDemo && ` · demo data anchored to ${anchor}`} · {totalRecords.toLocaleString()} records across{" "}
          {counts.length} entities · checked live against the database
        </p>
      </header>

      <section
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border px-4 py-3"
        aria-label="Summary"
      >
        <StatusBadge status={allPass ? "healthy" : "critical"}>
          {allPass ? "All passing" : `${checks.length - passing} failing`}
        </StatusBadge>
        <p className="text-sm">
          <span className="font-semibold tabular-nums">
            {passing}/{checks.length}
          </span>{" "}
          integrity checks passing
          {belowTarget.length > 0 && (
            <>
              {" · "}
              <span className="text-amber-400">
                {belowTarget.length} entit{belowTarget.length === 1 ? "y" : "ies"} below target volume
              </span>
            </>
          )}
        </p>
        {!allPass && (
          <p className="text-sm text-muted-foreground">
            If this is demo data, fix <code className="font-mono text-foreground">lib/demo/seed.ts</code> and start a new workspace with demo data.
          </p>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="checks-heading">
        <h2 id="checks-heading" className="text-sm font-medium text-muted-foreground">
          Integrity checks
        </h2>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Status</TableHead>
                <TableHead>Check</TableHead>
                <TableHead className="text-right">Scope</TableHead>
                <TableHead className="text-right">Violations</TableHead>
                <TableHead>Evidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checks.map((c) => (
                <TableRow key={c.id} className="align-top">
                  <TableCell>
                    <StatusBadge status={c.passed ? "healthy" : "critical"}>
                      {c.passed ? "Pass" : "Fail"}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.rule}</div>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                    {c.checked.toLocaleString()} {c.checkedLabel}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${c.passed ? "text-muted-foreground" : "font-semibold text-red-400"}`}
                  >
                    {c.violations.length}
                  </TableCell>
                  <TableCell className="whitespace-normal text-xs">
                    {c.passed ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {c.violations.slice(0, EVIDENCE_LIMIT).map((v) => (
                          <li key={`${v.recordId}-${v.detail}`}>
                            <span className="font-mono text-foreground">{v.recordId}</span>{" "}
                            <span className="text-muted-foreground">{v.detail}</span>
                          </li>
                        ))}
                        {c.violations.length > EVIDENCE_LIMIT && (
                          <li className="text-muted-foreground">
                            +{c.violations.length - EVIDENCE_LIMIT} more
                          </li>
                        )}
                      </ul>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="counts-heading">
        <h2 id="counts-heading" className="text-sm font-medium text-muted-foreground">
          Record counts
        </h2>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entity</TableHead>
                <TableHead className="text-right">Records</TableHead>
                <TableHead className="text-right">Target</TableHead>
                <TableHead className="w-32">Volume</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {counts.map((c) => {
                const meets = c.target == null || c.count >= c.target;
                return (
                  <TableRow key={c.entity}>
                    <TableCell className="font-mono text-xs">{c.entity}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {c.count.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {c.target == null ? "—" : `≥ ${c.target}`}
                    </TableCell>
                    <TableCell>
                      {c.target == null ? (
                        <span className="text-xs text-muted-foreground">No target</span>
                      ) : (
                        <StatusBadge status={meets ? "healthy" : "attention"}>
                          {meets ? "Meets target" : "Below target"}
                        </StatusBadge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
