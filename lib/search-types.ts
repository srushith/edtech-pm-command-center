// Shared by the search index (server) and the ⌘K palette (client).
export type EntityType =
  | "course" | "cohort" | "instructor" | "sme" | "module" | "session"
  | "issue" | "project" | "launch" | "feedback";

export const ENTITY_LABELS: Record<EntityType, string> = {
  course: "Courses",
  cohort: "Cohorts",
  instructor: "Instructors",
  sme: "SMEs",
  module: "Modules",
  session: "Sessions",
  issue: "Issues",
  project: "Projects & Capstones",
  launch: "Launches",
  feedback: "Learner feedback",
};

/** Searchable text that isn't shown in the label/sublabel (description, tags, email…). */
export type SearchField = { name: string; text: string };

export type SearchItem = {
  type: EntityType;
  id: string;
  label: string;
  sublabel: string;
  fields: SearchField[];
  href: string;
};
