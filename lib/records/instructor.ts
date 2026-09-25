import { z } from "zod";
import { HiringStage, Region } from "@/lib/generated/prisma/enums";
import { choice, date, defineRecord, email, enumOptions, isoDate, tags, text, type FieldErrors } from "./kit";

const REGIONS = Object.values(Region);
const STAGES = Object.values(HiringStage);

export const instructorRecord = defineRecord({
  type: "instructor",
  noun: "instructor",
  schema: z.object({
    name: text("Name", 80),
    email: email(),
    expertise: tags("Expertise", true),
    region: choice("Region", REGIONS),
    hiringStage: choice("Hiring stage", STAGES),
    joinedAt: date("Joined or sourced on"),
  }),
  fields: [
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "email", label: "Email", kind: "text", required: true, placeholder: "name@company.com" },
    { name: "expertise", label: "Expertise", kind: "tags", required: true, placeholder: "rag, evals, agents", wide: true, hint: "Comma-separated. Rating is computed from their sessions." },
    { name: "region", label: "Region", kind: "select", required: true, options: enumOptions(REGIONS) },
    { name: "hiringStage", label: "Hiring stage", kind: "select", required: true, options: enumOptions(STAGES) },
    { name: "joinedAt", label: "Joined or sourced on", kind: "date", required: true },
  ],
  checks: (d, { now }) => {
    const e: FieldErrors = {};
    if (d.joinedAt > now) e.joinedAt = "This date can't be in the future.";
    return e;
  },
  defaults: (_, now) => ({ name: "", email: "", expertise: "", region: "GLOBAL", hiringStage: "SOURCED", joinedAt: isoDate(now) }),
});
