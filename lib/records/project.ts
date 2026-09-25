import { z } from "zod";
import { ProjectStatus, ProjectType } from "@/lib/generated/prisma/enums";
import { inCohortWindow } from "@/lib/domain/time";
import { choice, date, defineRecord, enumOptions, num, optNum, ref, text, type FieldErrors, type FormOptions, type Values } from "./kit";

const TYPES = Object.values(ProjectType);
const STATUSES = Object.values(ProjectStatus);

const cohortOf = (v: Values, o: FormOptions) => o.cohorts.find((c) => c.id === v.cohortId);

export const projectRecord = defineRecord({
  type: "project",
  noun: "project",
  schema: z.object({
    courseId: ref("Course"),
    cohortId: ref("Cohort"),
    title: text("Title", 100),
    description: text("Brief", 400),
    type: choice("Type", TYPES),
    status: choice("Status", STATUSES),
    dueDate: date("Due date"),
    submissions: num("Submissions", 0, 99),
    avgScore: optNum("Average score", 0, 100, false),
  }),
  fields: [
    { name: "courseId", label: "Course", kind: "ref", ref: "course", required: true },
    {
      name: "cohortId", label: "Cohort", kind: "ref", ref: "cohort", required: true,
      refFilter: (id, v, o) => o.cohorts.find((c) => c.id === id)?.courseId === v.courseId,
      hint: (v) => (v.courseId ? null : "Pick a course first."),
    },
    { name: "title", label: "Title", kind: "text", required: true, wide: true, placeholder: "AI Engineering Capstone" },
    { name: "description", label: "Brief", kind: "textarea", required: true, wide: true },
    { name: "type", label: "Type", kind: "select", required: true, options: enumOptions(TYPES) },
    { name: "status", label: "Status", kind: "select", required: true, options: enumOptions(STATUSES) },
    {
      name: "dueDate", label: "Due date", kind: "date", required: true,
      hint: (v, o) => {
        const c = cohortOf(v, o);
        return c ? `Within ${c.code}: ${c.startDate.slice(0, 10)} to ${c.endDate.slice(0, 10)}.` : null;
      },
    },
    {
      name: "submissions", label: "Submissions", kind: "number", required: true,
      hint: (v, o) => {
        const c = cohortOf(v, o);
        return c ? `At most ${c.enrolledLearners} (learners in ${c.code}).` : null;
      },
    },
    { name: "avgScore", label: "Average score (0–100)", kind: "number", step: 0.1, required: true, showIf: (v) => v.status === "COMPLETED" },
  ],
  checks: (d, { lookup }) => {
    const e: FieldErrors = {};
    if (!lookup.course(d.courseId)) e.courseId = "That course doesn't exist in this workspace.";
    const cohort = lookup.cohort(d.cohortId);
    if (!cohort) return { ...e, cohortId: "That cohort doesn't exist in this workspace." };
    if (cohort.courseId !== d.courseId) e.cohortId = `${cohort.code} isn't a cohort of this course.`;
    if (!inCohortWindow(d.dueDate, { startDate: new Date(cohort.startDate), endDate: new Date(cohort.endDate) })) {
      e.dueDate = `Must fall within ${cohort.code} (${cohort.startDate.slice(0, 10)} to ${cohort.endDate.slice(0, 10)}).`;
    }
    if (d.submissions > cohort.enrolledLearners) e.submissions = `Can't exceed the ${cohort.enrolledLearners} learners in ${cohort.code}.`;
    if (d.status === "NOT_STARTED" && d.submissions > 0) e.submissions = "A project that hasn't started has no submissions.";
    if (d.status === "COMPLETED" && d.avgScore == null) e.avgScore = "A completed project needs its average score.";
    return e;
  },
  defaults: (o) => ({
    courseId: o.courses.length === 1 ? o.courses[0].id : "", cohortId: "", title: "", description: "",
    type: "PROJECT", status: "NOT_STARTED", dueDate: "", submissions: "0", avgScore: "",
  }),
});
