// A deterministic stand-in for a model: header synonyms + word overlap, checked
// against what the sample values look like. Good enough to demo the flow honestly.
import type { AIProvider, ColumnSample, ColumnSuggestion, MappingField } from "@/lib/ai/provider";

const SYNONYMS: Record<string, string[]> = {
  code: ["code", "id", "short code", "course code", "cohort code", "key"],
  name: ["name", "full name", "title", "course", "course name", "cohort name", "instructor", "sme", "person"],
  title: ["title", "module", "module name", "module title", "name", "topic"],
  region: ["region", "geo", "market", "country"],
  track: ["track", "category", "program", "vertical"],
  status: ["status", "state", "phase"],
  description: ["description", "summary", "about", "details", "overview", "notes"],
  courseId: ["course", "course code", "course name", "program"],
  startDate: ["start", "start date", "starts", "begins", "launch date", "kickoff"],
  endDate: ["end", "end date", "ends", "finish", "graduation"],
  capacity: ["capacity", "seats", "max learners", "max students", "size"],
  enrolledLearners: ["enrolled", "enrolment", "enrollment", "learners", "students", "headcount"],
  health: ["health", "rag status", "health status"],
  email: ["email", "e-mail", "mail", "email address"],
  expertise: ["expertise", "skills", "topics", "specialties", "areas"],
  hiringStage: ["stage", "hiring stage", "pipeline", "status"],
  joinedAt: ["joined", "start date", "since", "sourced on", "added"],
  domain: ["domain", "expertise", "area", "field"],
  company: ["company", "employer", "organisation", "organization", "org"],
  hoursPerWeek: ["hours", "hours per week", "availability", "hrs/week"],
  tags: ["tags", "topics", "keywords", "labels"],
  stage: ["stage", "status", "phase"],
  ownerName: ["owner", "author", "responsible", "pm"],
  reviewerId: ["reviewer", "sme", "sme reviewer", "reviewed by"],
  dueDate: ["due", "due date", "deadline", "target date"],
};

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function headerScore(header: string, f: MappingField): number {
  const h = words(header);
  const candidates = [words(f.label.replace(/\(.*\)/, "")), words(f.name.replace(/([A-Z])/g, " $1")), ...(SYNONYMS[f.name] ?? [])];
  if (candidates.includes(h)) return 0.9;
  const hw = new Set(h.split(" "));
  let best = 0;
  for (const c of candidates) {
    const cw = c.split(" ");
    const overlap = cw.filter((w) => hw.has(w)).length / Math.max(cw.length, hw.size);
    best = Math.max(best, overlap * 0.8);
  }
  return best;
}

function sampleFit(samples: string[], f: MappingField): { fit: number; note: string } {
  const s = samples.filter(Boolean);
  if (s.length === 0) return { fit: 0.5, note: "no sample values" };
  const share = (re: RegExp) => s.filter((x) => re.test(x)).length / s.length;
  switch (f.kind) {
    case "date": { const r = share(/^\d{4}-\d{1,2}-\d{1,2}|^\d{1,2}[/ .-]|^[a-z]{3} \d/i); return { fit: r, note: r > 0.5 ? "samples look like dates" : "samples don't look like dates" }; }
    case "number": { const r = share(/^-?[\d,]+(\.\d+)?$/); return { fit: r, note: r > 0.5 ? "samples are numbers" : "samples aren't numbers" }; }
    case "select": {
      const opts = (f.options ?? []).map(words);
      const r = s.filter((x) => opts.includes(words(x))).length / s.length;
      return { fit: r, note: r > 0.5 ? "samples are valid options" : "samples aren't valid options" };
    }
    default:
      if (f.name === "email") { const r = share(/@/); return { fit: r, note: r > 0.5 ? "samples are email addresses" : "samples aren't emails" }; }
      return { fit: 0.6, note: "text samples" };
  }
}

export const mockProvider: AIProvider = {
  name: "Mock AI",
  async suggestColumnMapping({ columns, fields }: { recordType: string; columns: ColumnSample[]; fields: MappingField[] }) {
    const scored: ColumnSuggestion[] = [];
    for (const col of columns) {
      for (const f of fields) {
        const h = headerScore(col.header, f);
        if (h < 0.3) continue;
        const { fit, note } = sampleFit(col.samples, f);
        const confidence = Math.round((h * 0.7 + fit * 0.3) * 100) / 100;
        if (confidence < 0.5) continue;
        scored.push({ header: col.header, field: f.name, confidence, reason: `Header "${col.header}" ≈ ${f.label}; ${note}.` });
      }
    }
    // Greedy one-to-one: best-scoring pairs first.
    scored.sort((a, b) => b.confidence - a.confidence);
    const usedCols = new Set<string>();
    const usedFields = new Set<string>();
    return scored.filter((s) => {
      if (usedCols.has(s.header) || usedFields.has(s.field)) return false;
      usedCols.add(s.header);
      usedFields.add(s.field);
      return true;
    });
  },
};
