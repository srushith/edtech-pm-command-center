import { z } from "zod";
import { IssueCategory, IssueStatus, Severity } from "@/lib/generated/prisma/enums";
import { choice, dateTime, defineRecord, enumOptions, optDateTime, optRef, optText, text, type FieldErrors } from "./kit";

const CATEGORIES = Object.values(IssueCategory);
const SEVERITIES = Object.values(Severity);
const STATUSES = Object.values(IssueStatus);

export const issueRecord = defineRecord({
  type: "issue",
  noun: "issue",
  schema: z.object({
    title: text("Title", 120),
    description: text("Description", 600),
    category: choice("Category", CATEGORIES),
    severity: choice("Severity", SEVERITIES),
    status: choice("Status", STATUSES),
    ownerName: optText("Owner", 60),
    courseId: optRef(),
    cohortId: optRef(),
    sessionId: optRef(),
    openedAt: dateTime("Opened at"),
    resolvedAt: optDateTime("Resolved at"),
  }),
  fields: [
    { name: "title", label: "Title", kind: "text", required: true, wide: true, hint: "A code like ISS-125 is assigned on save." },
    { name: "description", label: "Description", kind: "textarea", required: true, wide: true },
    { name: "category", label: "Category", kind: "select", required: true, options: enumOptions(CATEGORIES) },
    { name: "severity", label: "Severity", kind: "select", required: true, options: enumOptions(SEVERITIES) },
    { name: "status", label: "Status", kind: "select", required: true, options: enumOptions(STATUSES) },
    { name: "ownerName", label: "Owner", kind: "text", hint: "Leave empty to flag it as unassigned." },
    { name: "courseId", label: "Course", kind: "ref", ref: "course" },
    {
      name: "cohortId", label: "Cohort", kind: "ref", ref: "cohort",
      refFilter: (id, v, o) => !v.courseId || o.cohorts.find((c) => c.id === id)?.courseId === v.courseId,
    },
    {
      name: "sessionId", label: "Session", kind: "ref", ref: "session", wide: true,
      refFilter: (id, v, o) => !v.cohortId || o.sessions.find((s) => s.id === id)?.cohortId === v.cohortId,
      hint: "Picking a session or cohort fills in the ones above it.",
    },
    { name: "openedAt", label: "Opened at", kind: "datetime", required: true },
    { name: "resolvedAt", label: "Resolved at", kind: "datetime", required: true, showIf: (v) => v.status === "RESOLVED" },
  ],
  checks: (d, { lookup, now }) => {
    const e: FieldErrors = {};
    const course = d.courseId ? lookup.course(d.courseId) : null;
    const cohort = d.cohortId ? lookup.cohort(d.cohortId) : null;
    const session = d.sessionId ? lookup.session(d.sessionId) : null;
    if (d.courseId && !course) e.courseId = "That course doesn't exist in this workspace.";
    if (d.cohortId && !cohort) e.cohortId = "That cohort doesn't exist in this workspace.";
    if (d.sessionId && !session) e.sessionId = "That session doesn't exist in this workspace.";
    if (course && cohort && cohort.courseId !== course.id) e.cohortId = `${cohort.code} isn't a cohort of ${course.code}.`;
    if (cohort && session && session.cohortId !== cohort.id) e.sessionId = `That session isn't in ${cohort.code}.`;
    if (d.openedAt > now) e.openedAt = "An issue can't be opened in the future.";
    if (d.status === "RESOLVED") {
      if (!d.resolvedAt) e.resolvedAt = "When was it resolved?";
      else if (d.resolvedAt < d.openedAt) e.resolvedAt = "Resolved can't be before opened.";
      else if (d.resolvedAt > now) e.resolvedAt = "This can't be in the future.";
    }
    return e;
  },
  defaults: (_, now) => ({
    title: "", description: "", category: "CONTENT", severity: "MEDIUM", status: "OPEN", ownerName: "",
    courseId: "", cohortId: "", sessionId: "", openedAt: now.toISOString(), resolvedAt: "",
  }),
});
