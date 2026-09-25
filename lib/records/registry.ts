// Every creatable record type, in Quick add order. Shared by client and server.
import type { SectionId } from "@/lib/nav";
import type { EntityType } from "@/lib/search-types";
import { cohortRecord } from "./cohort";
import { courseRecord } from "./course";
import { feedbackRecord } from "./feedback";
import { instructorRecord } from "./instructor";
import { issueRecord } from "./issue";
import type { RecordDef } from "./kit";
import { launchRecord } from "./launch";
import { moduleRecord } from "./module";
import { projectRecord } from "./project";
import { sessionRecord } from "./session";
import { smeRecord } from "./sme";

export const RECORDS: Record<EntityType, RecordDef<Record<string, unknown>>> = {
  course: courseRecord,
  cohort: cohortRecord,
  launch: launchRecord,
  module: moduleRecord,
  instructor: instructorRecord,
  sme: smeRecord,
  project: projectRecord,
  issue: issueRecord,
  session: sessionRecord,
  feedback: feedbackRecord,
} as unknown as Record<EntityType, RecordDef<Record<string, unknown>>>;

export const RECORD_TYPES = Object.keys(RECORDS) as EntityType[];

/** Which section page lists (and adds) each type. */
export const RECORD_SECTION: Record<EntityType, SectionId> = {
  course: "courses",
  cohort: "cohorts",
  launch: "launches",
  module: "curriculum",
  instructor: "talent",
  sme: "talent",
  project: "projects",
  issue: "operations",
  session: "class-health",
  feedback: "learner-voice",
};

export const SECTION_RECORDS: Partial<Record<SectionId, EntityType[]>> = {};
for (const t of RECORD_TYPES) (SECTION_RECORDS[RECORD_SECTION[t]] ??= []).push(t);

export function isRecordType(v: unknown): v is EntityType {
  return typeof v === "string" && v in RECORDS;
}
