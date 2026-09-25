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

export type SearchItem = {
  type: EntityType;
  id: string;
  label: string;
  sublabel: string;
  keywords: string[];
  href: string;
};
