import { z } from "zod";
import { HealthStatus } from "@/lib/generated/prisma/enums";
import { choice, date, defineRecord, enumOptions, isoDate, num, ref, text, type FieldErrors } from "./kit";

const HEALTH = Object.values(HealthStatus);
export const MAX_LEARNERS = 99; // program rule: every cohort is under 100 learners

export const cohortRecord = defineRecord({
  type: "cohort",
  noun: "cohort",
  schema: z.object({
    courseId: ref("Course"),
    code: text("Code", 16).transform((v) => v.toUpperCase()).pipe(
      z.string().regex(/^[A-Z0-9-]{2,16}$/, "Code is letters, digits or dashes, e.g. AIE-C3."),
    ),
    name: text("Name", 80),
    startDate: date("Start date"),
    endDate: date("End date"),
    capacity: num("Capacity", 1, MAX_LEARNERS),
    enrolledLearners: num("Enrolled learners", 0, MAX_LEARNERS),
    health: choice("Health", HEALTH),
  }),
  fields: [
    { name: "courseId", label: "Course", kind: "ref", ref: "course", required: true, hint: "Every cohort belongs to a course." },
    { name: "code", label: "Code", kind: "text", required: true, placeholder: "AIE-C2" },
    { name: "name", label: "Name", kind: "text", required: true, placeholder: "AI Engineering · Cohort 2" },
    { name: "health", label: "Health", kind: "select", required: true, options: enumOptions(HEALTH) },
    { name: "startDate", label: "Start date", kind: "date", required: true },
    { name: "endDate", label: "End date", kind: "date", required: true, hint: "Inclusive. Status (upcoming, active, completed) follows from the dates." },
    { name: "capacity", label: "Capacity", kind: "number", required: true, hint: `At most ${MAX_LEARNERS}.` },
    { name: "enrolledLearners", label: "Enrolled learners", kind: "number", required: true, hint: "Can't exceed capacity." },
  ],
  checks: (d, { lookup }) => {
    const e: FieldErrors = {};
    if (!lookup.course(d.courseId)) e.courseId = "That course doesn't exist in this workspace.";
    if (d.endDate < d.startDate) e.endDate = "End date must be on or after the start date.";
    if (d.enrolledLearners > d.capacity) e.enrolledLearners = `Enrolled (${d.enrolledLearners}) can't exceed capacity (${d.capacity}).`;
    return e;
  },
  defaults: (o, now) => ({
    courseId: o.courses.length === 1 ? o.courses[0].id : "", code: "", name: "", health: "HEALTHY",
    startDate: isoDate(now), endDate: isoDate(new Date(now.getTime() + 70 * 86_400_000)), capacity: "60", enrolledLearners: "0",
  }),
});
