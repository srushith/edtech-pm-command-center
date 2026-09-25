import { z } from "zod";
import { SessionStatus } from "@/lib/generated/prisma/enums";
import { inCohortWindow } from "@/lib/domain/time";
import { choice, dateTime, defineRecord, enumOptions, num, optNum, optRef, ref, text, type FieldErrors, type FormOptions, type Values } from "./kit";

const STATUSES = Object.values(SessionStatus);

const cohortOf = (v: Values, o: FormOptions) => o.cohorts.find((c) => c.id === v.cohortId);
const feedbackCount = (v: Values, o: FormOptions) => o.sessions.find((s) => s.id === v._id)?.feedbackCount ?? 0;

export const sessionRecord = defineRecord({
  type: "session",
  noun: "session",
  schema: z.object({
    cohortId: ref("Cohort"),
    moduleId: optRef(),
    instructorId: ref("Instructor"),
    smeId: optRef(),
    title: text("Title", 120),
    scheduledAt: dateTime("Date and time"),
    durationMin: num("Duration", 15, 480),
    status: choice("Status", STATUSES),
    attendance: optNum("Attendance", 0, 99),
    avgRating: optNum("Average rating", 1, 5, false),
  }),
  fields: [
    { name: "cohortId", label: "Cohort", kind: "ref", ref: "cohort", required: true },
    {
      name: "moduleId", label: "Module", kind: "ref", ref: "module",
      refFilter: (id, v, o) => o.modules.find((m) => m.id === id)?.courseId === cohortOf(v, o)?.courseId,
      hint: (v, o) => (cohortOf(v, o) ? null : "Pick a cohort first; modules come from its course."),
    },
    { name: "title", label: "Title", kind: "text", required: true, wide: true, placeholder: "LLM Application Architecture & RAG — Week 3" },
    {
      name: "instructorId", label: "Instructor", kind: "ref", ref: "instructor", required: true,
      // Active instructors, plus whoever is already assigned when editing.
      refFilter: (id, v, o) => o.instructors.find((i) => i.id === id)?.hiringStage === "ACTIVE" || id === v._instructorId,
      hint: "Active instructors only.",
    },
    { name: "smeId", label: "Guest SME", kind: "ref", ref: "sme" },
    {
      name: "scheduledAt", label: "Date and time", kind: "datetime", required: true,
      hint: (v, o) => {
        const c = cohortOf(v, o);
        return c ? `Within ${c.code}: ${c.startDate.slice(0, 10)} to ${c.endDate.slice(0, 10)}.` : null;
      },
    },
    { name: "durationMin", label: "Duration (minutes)", kind: "number", required: true },
    { name: "status", label: "Status", kind: "select", required: true, options: enumOptions(STATUSES), hint: "Completed or cancelled needs a date in the past." },
    {
      name: "attendance", label: "Attendance", kind: "number", required: true,
      showIf: (v) => v.status === "COMPLETED",
      hint: (v, o) => {
        const c = cohortOf(v, o);
        return c ? `At most ${c.enrolledLearners} (learners in ${c.code}).` : null;
      },
    },
    {
      name: "avgRating", label: "Average rating (1–5)", kind: "number", step: 0.01,
      showIf: (v) => v.status === "COMPLETED",
      lockedIf: (v, o) => {
        const n = feedbackCount(v, o);
        return n > 0 ? `Computed from ${n} feedback entr${n === 1 ? "y" : "ies"}.` : null;
      },
      hint: "For a survey average when there's no individual feedback.",
    },
  ],
  checks: (d, { lookup, now, existing }) => {
    const e: FieldErrors = {};
    const cohort = lookup.cohort(d.cohortId);
    if (!cohort) return { cohortId: "That cohort doesn't exist in this workspace." };
    if (d.moduleId) {
      const m = lookup.module(d.moduleId);
      if (!m) e.moduleId = "That module doesn't exist in this workspace.";
      else if (m.courseId !== cohort.courseId) e.moduleId = `That module belongs to a different course than ${cohort.code}.`;
    }
    const ins = lookup.instructor(d.instructorId);
    if (!ins) e.instructorId = "That instructor doesn't exist in this workspace.";
    else if (ins.hiringStage !== "ACTIVE" && existing?.instructorId !== d.instructorId) e.instructorId = `${ins.name} isn't an active instructor.`;
    if (d.smeId && !lookup.sme(d.smeId)) e.smeId = "That SME doesn't exist in this workspace.";

    const window = { startDate: new Date(cohort.startDate), endDate: new Date(cohort.endDate) };
    if (!inCohortWindow(d.scheduledAt, window)) {
      e.scheduledAt = `Must fall within ${cohort.code} (${cohort.startDate.slice(0, 10)} to ${cohort.endDate.slice(0, 10)}).`;
    }
    const past = d.scheduledAt <= now;
    if (d.status === "SCHEDULED" && past) e.status = "This date has passed: mark it completed or cancelled.";
    if (d.status !== "SCHEDULED" && !past) e.status = `A future session can't be ${d.status.toLowerCase()}.`;

    const feedback = existing?._id ? (lookup.session(existing._id)?.feedbackCount ?? 0) : 0;
    if (d.status === "COMPLETED") {
      if (d.attendance == null) e.attendance = "Attendance is required for a completed session.";
      else if (d.attendance > cohort.enrolledLearners) e.attendance = `Attendance (${d.attendance}) can't exceed the ${cohort.enrolledLearners} learners in ${cohort.code}.`;
      else if (d.attendance < feedback) e.attendance = `${feedback} learners left feedback, so attendance is at least ${feedback}.`;
      if (d.avgRating != null && feedback > 0) e.avgRating = "This session has feedback, so its rating is computed from it.";
    } else if (feedback > 0) {
      e.status = `This session has ${feedback} feedback entries, so it must stay completed.`;
    }
    return e;
  },
  defaults: (_, now) => ({
    cohortId: "", moduleId: "", instructorId: "", smeId: "", title: "",
    // Next full hour, tomorrow.
    scheduledAt: new Date(Math.ceil(now.getTime() / 3_600_000) * 3_600_000 + 86_400_000).toISOString(),
    durationMin: "90", status: "SCHEDULED", attendance: "", avgRating: "",
  }),
});
