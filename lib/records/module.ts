import { z } from "zod";
import { ModuleStage } from "@/lib/generated/prisma/enums";
import { choice, date, defineRecord, enumOptions, isoDate, optRef, ref, tags, text, type FieldErrors } from "./kit";

const STAGES = Object.values(ModuleStage);

export const moduleRecord = defineRecord({
  type: "module",
  noun: "curriculum module",
  schema: z.object({
    courseId: ref("Course"),
    title: text("Title", 100),
    description: text("Description", 400),
    tags: tags("Topic"),
    stage: choice("Stage", STAGES),
    ownerName: text("Owner", 60),
    reviewerId: optRef(),
    dueDate: date("Due date"),
  }),
  fields: [
    { name: "courseId", label: "Course", kind: "ref", ref: "course", required: true },
    { name: "title", label: "Title", kind: "text", required: true, wide: true },
    { name: "description", label: "Description", kind: "textarea", required: true, wide: true },
    { name: "tags", label: "Topics", kind: "tags", placeholder: "rag, embeddings", wide: true, hint: "Comma-separated; searchable in ⌘K." },
    { name: "stage", label: "Stage", kind: "select", required: true, options: enumOptions(STAGES) },
    { name: "ownerName", label: "Owner", kind: "text", required: true },
    { name: "reviewerId", label: "SME reviewer", kind: "ref", ref: "sme" },
    { name: "dueDate", label: "Due date", kind: "date", required: true },
  ],
  checks: (d, { lookup }) => {
    const e: FieldErrors = {};
    if (!lookup.course(d.courseId)) e.courseId = "That course doesn't exist in this workspace.";
    if (d.reviewerId && !lookup.sme(d.reviewerId)) e.reviewerId = "That SME doesn't exist in this workspace.";
    return e;
  },
  defaults: (o, now) => ({
    courseId: o.courses.length === 1 ? o.courses[0].id : "", title: "", description: "", tags: "", stage: "PLANNED",
    ownerName: "", reviewerId: "", dueDate: isoDate(new Date(now.getTime() + 30 * 86_400_000)),
  }),
});
