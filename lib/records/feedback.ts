import { z } from "zod";
import { choice, dateTime, defineRecord, num, ref, text, type FieldErrors, type FormOptions, type Values } from "./kit";

export const FEEDBACK_THEMES = ["pacing", "clarity", "examples", "depth", "engagement", "audio"] as const;

const sessionOf = (v: Values, o: FormOptions) => o.sessions.find((s) => s.id === v.sessionId);

export const feedbackRecord = defineRecord({
  type: "feedback",
  noun: "learner feedback",
  schema: z.object({
    sessionId: ref("Session"),
    learnerNumber: num("Learner number", 1, 99),
    rating: num("Rating", 1, 5),
    theme: choice("Theme", FEEDBACK_THEMES),
    comment: text("Comment", 500),
    createdAt: dateTime("Submitted at"),
  }),
  fields: [
    {
      name: "sessionId", label: "Session", kind: "ref", ref: "session", required: true, wide: true,
      refFilter: (id, _v, o) => o.sessions.find((s) => s.id === id)?.status === "COMPLETED",
      hint: "Completed sessions only. Sentiment follows from the rating.",
    },
    {
      name: "learnerNumber", label: "Learner #", kind: "number", required: true,
      hint: (v, o) => {
        const s = sessionOf(v, o);
        const c = s && o.cohorts.find((x) => x.id === s.cohortId);
        return c ? `1–${c.enrolledLearners}; saved as ${c.code}-L###.` : null;
      },
    },
    { name: "rating", label: "Rating (1–5)", kind: "number", required: true },
    { name: "theme", label: "Theme", kind: "select", required: true, options: FEEDBACK_THEMES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) })) },
    { name: "createdAt", label: "Submitted at", kind: "datetime", required: true },
    { name: "comment", label: "Comment", kind: "textarea", required: true, wide: true },
  ],
  checks: (d, { lookup, now, existing }) => {
    const e: FieldErrors = {};
    const s = lookup.session(d.sessionId);
    if (!s) return { sessionId: "That session doesn't exist in this workspace." };
    if (s.status !== "COMPLETED") return { sessionId: "Feedback can only be added to a completed session." };
    const cohort = lookup.cohort(s.cohortId);
    if (cohort && d.learnerNumber > cohort.enrolledLearners) e.learnerNumber = `${cohort.code} has ${cohort.enrolledLearners} learners.`;
    // Each respondent attended, so a session can't have more feedback than attendees.
    if (existing?.sessionId !== d.sessionId && s.feedbackCount + 1 > (s.attendance ?? 0)) {
      e.sessionId = `That session already has ${s.feedbackCount} feedback entries for ${s.attendance ?? 0} attendees.`;
    }
    if (d.createdAt < new Date(s.scheduledAt)) e.createdAt = "Feedback can't be submitted before the session started.";
    else if (d.createdAt > now) e.createdAt = "This can't be in the future.";
    return e;
  },
  defaults: (_, now) => ({ sessionId: "", learnerNumber: "", rating: "", theme: "", comment: "", createdAt: now.toISOString() }),
});
