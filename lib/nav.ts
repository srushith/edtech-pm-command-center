import {
  BookOpen,
  BrainCircuit,
  Database,
  FileUp,
  FolderKanban,
  GraduationCap,
  HeartPulse,
  LayoutDashboard,
  Library,
  MessageSquareText,
  Rocket,
  Settings,
  UsersRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type SectionId =
  | "command-center"
  | "cohorts"
  | "courses"
  | "curriculum"
  | "talent"
  | "class-health"
  | "learner-voice"
  | "launches"
  | "projects"
  | "operations"
  | "ai-insights"
  | "data"
  | "settings"
  | "import";

export type Section = {
  id: SectionId;
  title: string;
  href: string;
  icon: LucideIcon;
  phase: string; // build phase that delivers the real page
  description: string;
  shortcut: string; // "g" then this key
};

// The 11 main-nav sections, in sidebar order (see CLAUDE.md).
export const SECTIONS: Section[] = [
  { id: "command-center", title: "Command Center", href: "/", icon: LayoutDashboard, phase: "2", shortcut: "h",
    description: "What needs attention, what changed, risk radar and today's brief." },
  { id: "cohorts", title: "Cohorts", href: "/cohorts", icon: UsersRound, phase: "4", shortcut: "c",
    description: "Cohort timeline with collision warnings, health and enrolment." },
  { id: "courses", title: "Courses", href: "/courses", icon: Library, phase: "2", shortcut: "o",
    description: "Portfolio health across all courses and regions." },
  { id: "curriculum", title: "Curriculum", href: "/curriculum", icon: BookOpen, phase: "6", shortcut: "u",
    description: "Module roadmap, kanban/timeline with bottleneck detection, version history." },
  { id: "talent", title: "Instructor / SME Hub", href: "/talent", icon: GraduationCap, phase: "5", shortcut: "i",
    description: "Hiring pipeline, profiles, matching engine and performance cards." },
  { id: "class-health", title: "Class Health", href: "/class-health", icon: HeartPulse, phase: "3", shortcut: "l",
    description: "Low-rated session detection with a \"Why?\" drill-down." },
  { id: "learner-voice", title: "Learner Voice", href: "/learner-voice", icon: MessageSquareText, phase: "3", shortcut: "v",
    description: "Feedback clusters and sentiment trends." },
  { id: "launches", title: "Launches", href: "/launches", icon: Rocket, phase: "4", shortcut: "n",
    description: "Upcoming launches and their readiness checklists." },
  { id: "projects", title: "Projects & Capstones", href: "/projects", icon: FolderKanban, phase: "7", shortcut: "p",
    description: "Project and capstone progress, submissions and grading." },
  { id: "operations", title: "Operations", href: "/operations", icon: Wrench, phase: "7", shortcut: "s",
    description: "Issue tracker and issue intelligence (pattern clustering)." },
  { id: "ai-insights", title: "AI Insights", href: "/ai-insights", icon: BrainCircuit, phase: "8", shortcut: "a",
    description: "Copilot with cited records, PM Memory, what-if simulator, weekly review." },
];

// Outside the main nav: sidebar footer and ⌘K only.
export const DATA_SECTION: Section = {
  id: "data", title: "Data Integrity", href: "/data", icon: Database, phase: "1", shortcut: "d",
  description: "Record counts and live integrity checks on this workspace's data.",
};

export const SETTINGS_SECTION: Section = {
  id: "settings", title: "Settings", href: "/settings", icon: Settings, phase: "1.5", shortcut: "t",
  description: "Workspace name, members, invites, roles and demo data.",
};

export const IMPORT_SECTION: Section = {
  id: "import", title: "Import", href: "/import", icon: FileUp, phase: "1.5", shortcut: "m",
  description: "Import courses, cohorts, instructors, SMEs and modules from CSV or Google Sheets; sync linked sheets.",
};

export const ALL_SECTIONS = [...SECTIONS, DATA_SECTION, SETTINGS_SECTION, IMPORT_SECTION];

export function sectionById(id: SectionId): Section {
  return ALL_SECTIONS.find((s) => s.id === id)!;
}

export function sectionForPath(pathname: string): Section | undefined {
  if (pathname === "/") return SECTIONS[0];
  return ALL_SECTIONS.find((s) => s.href !== "/" && (pathname === s.href || pathname.startsWith(`${s.href}/`)));
}
