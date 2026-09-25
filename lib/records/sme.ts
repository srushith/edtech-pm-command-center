import { z } from "zod";
import { HiringStage } from "@/lib/generated/prisma/enums";
import { choice, defineRecord, email, enumOptions, num, text } from "./kit";

const STAGES = Object.values(HiringStage);

export const smeRecord = defineRecord({
  type: "sme",
  noun: "SME",
  schema: z.object({
    name: text("Name", 80),
    email: email(),
    domain: text("Domain", 60),
    company: text("Company", 60),
    hoursPerWeek: num("Hours per week", 1, 40),
    hiringStage: choice("Hiring stage", STAGES),
  }),
  fields: [
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "email", label: "Email", kind: "text", required: true, placeholder: "name@company.com" },
    { name: "domain", label: "Domain", kind: "text", required: true, placeholder: "RAG & Retrieval" },
    { name: "company", label: "Company", kind: "text", required: true },
    { name: "hoursPerWeek", label: "Hours per week", kind: "number", required: true, hint: "1–40." },
    { name: "hiringStage", label: "Hiring stage", kind: "select", required: true, options: enumOptions(STAGES) },
  ],
  defaults: () => ({ name: "", email: "", domain: "", company: "", hoursPerWeek: "4", hiringStage: "SOURCED" }),
});
