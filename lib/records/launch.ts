import { z } from "zod";
import { LaunchStatus } from "@/lib/generated/prisma/enums";
import { choice, date, defineRecord, enumOptions, optRef, ref, text, type FieldErrors } from "./kit";

const STATUSES = Object.values(LaunchStatus);

export const launchRecord = defineRecord({
  type: "launch",
  noun: "launch",
  schema: z.object({
    name: text("Name", 100),
    courseId: ref("Course"),
    cohortId: optRef(),
    targetDate: date("Target date"),
    status: choice("Status", STATUSES),
    ownerName: text("Owner", 60),
  }),
  fields: [
    { name: "name", label: "Name", kind: "text", required: true, wide: true, placeholder: "AI Engineering · Cohort 2" },
    { name: "courseId", label: "Course", kind: "ref", ref: "course", required: true },
    {
      name: "cohortId", label: "Cohort", kind: "ref", ref: "cohort",
      refFilter: (id, v, o) => o.cohorts.find((c) => c.id === id)?.courseId === v.courseId,
      hint: "Optional: leave empty for a curriculum refresh or other non-cohort launch.",
    },
    {
      name: "targetDate", label: "Target date", kind: "date", required: true,
      hint: (v, o) => {
        const c = o.cohorts.find((x) => x.id === v.cohortId);
        return c ? `${c.code} starts ${c.startDate.slice(0, 10)}.` : null;
      },
    },
    { name: "status", label: "Status", kind: "select", required: true, options: enumOptions(STATUSES) },
    { name: "ownerName", label: "Owner", kind: "text", required: true, hint: "New launches get the standard readiness checklist, owned by this person." },
  ],
  checks: (d, { lookup }) => {
    const e: FieldErrors = {};
    if (!lookup.course(d.courseId)) e.courseId = "That course doesn't exist in this workspace.";
    if (d.cohortId) {
      const c = lookup.cohort(d.cohortId);
      if (!c) e.cohortId = "That cohort doesn't exist in this workspace.";
      else if (c.courseId !== d.courseId) e.cohortId = `${c.code} isn't a cohort of this course.`;
    }
    return e;
  },
  defaults: (o) => ({
    name: "", courseId: o.courses.length === 1 ? o.courses[0].id : "", cohortId: "", targetDate: "", status: "PLANNING", ownerName: "",
  }),
});
