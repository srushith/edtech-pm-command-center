import { z } from "zod";
import { CourseStatus, Region } from "@/lib/generated/prisma/enums";
import { choice, defineRecord, enumOptions, text } from "./kit";

const REGIONS = Object.values(Region);
const STATUSES = Object.values(CourseStatus);

export const courseRecord = defineRecord({
  type: "course",
  noun: "course",
  schema: z.object({
    code: text("Code", 12).transform((v) => v.toUpperCase()).pipe(
      z.string().regex(/^[A-Z0-9-]{2,12}$/, "Code is 2–12 letters, digits or dashes, e.g. AIE."),
    ),
    name: text("Name", 80),
    region: choice("Region", REGIONS),
    track: text("Track", 40),
    status: choice("Status", STATUSES),
    description: text("Description", 400),
  }),
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, placeholder: "AIE", hint: "Short unique code used in cohort codes and filters." },
    { name: "name", label: "Name", kind: "text", required: true, placeholder: "AI Engineering" },
    { name: "region", label: "Region", kind: "select", required: true, options: enumOptions(REGIONS) },
    { name: "track", label: "Track", kind: "text", required: true, placeholder: "AI" },
    { name: "status", label: "Status", kind: "select", required: true, options: enumOptions(STATUSES) },
    { name: "description", label: "Description", kind: "textarea", required: true, wide: true },
  ],
  defaults: () => ({ code: "", name: "", region: "GLOBAL", track: "", status: "IN_DEVELOPMENT", description: "" }),
});
