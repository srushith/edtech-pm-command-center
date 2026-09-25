import { db } from "@/lib/db";
import { sectionById, type SectionId } from "@/lib/nav";
import { ENTITY_LABELS, type EntityType, type SearchItem } from "@/lib/search-types";

export type { SearchItem };

// Where each entity lives until it gets its own detail view.
const ENTITY_SECTION: Record<EntityType, SectionId> = {
  course: "courses",
  cohort: "cohorts",
  instructor: "talent",
  sme: "talent",
  module: "curriculum",
  session: "class-health",
  issue: "operations",
  project: "projects",
  launch: "launches",
  feedback: "learner-voice",
};

const lower = (s: string) => s.toLowerCase().replaceAll("_", " ");
const day = (d: Date) => d.toISOString().slice(0, 10);
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function item(type: EntityType, id: string, label: string, sublabel: string, keywords: (string | null | undefined)[]): SearchItem {
  return {
    type,
    id,
    label,
    sublabel,
    keywords: keywords.filter((k): k is string => !!k),
    href: `${sectionById(ENTITY_SECTION[type]).href}?focus=${type}:${id}`,
  };
}

/**
 * Every searchable entity, flattened for the ⌘K palette. The dataset is a few
 * hundred rows, so the palette loads it once and filters client-side (portable
 * across SQLite/Postgres, no case-sensitivity differences).
 */
export async function getSearchIndex(): Promise<SearchItem[]> {
  const [courses, cohorts, instructors, smes, modules, sessions, issues, projects, launches, feedback] =
    await Promise.all([
      db.course.findMany({ select: { id: true, code: true, name: true, region: true, track: true, status: true }, orderBy: { code: "asc" } }),
      db.cohort.findMany({
        select: { id: true, code: true, name: true, status: true, health: true, enrolledLearners: true, course: { select: { name: true } } },
        orderBy: { code: "asc" },
      }),
      db.instructor.findMany({ select: { id: true, name: true, email: true, expertise: true, region: true, hiringStage: true }, orderBy: { name: "asc" } }),
      db.sME.findMany({ select: { id: true, name: true, email: true, domain: true, company: true, hiringStage: true }, orderBy: { name: "asc" } }),
      db.module.findMany({
        select: { id: true, title: true, stage: true, ownerName: true, course: { select: { code: true } } },
        orderBy: [{ courseId: "asc" }, { order: "asc" }],
      }),
      db.session.findMany({
        select: {
          id: true, title: true, scheduledAt: true, status: true,
          cohort: { select: { code: true } }, instructor: { select: { name: true } },
        },
        orderBy: { scheduledAt: "desc" },
      }),
      db.issue.findMany({ select: { id: true, code: true, title: true, category: true, severity: true, status: true, ownerName: true }, orderBy: { code: "asc" } }),
      db.project.findMany({
        select: { id: true, title: true, type: true, status: true, cohort: { select: { code: true } } },
        orderBy: { dueDate: "asc" },
      }),
      db.launch.findMany({
        select: { id: true, name: true, status: true, ownerName: true, targetDate: true, course: { select: { code: true } } },
        orderBy: { targetDate: "asc" },
      }),
      db.learnerFeedback.findMany({
        where: { sentiment: { in: ["NEGATIVE", "NEUTRAL"] } },
        select: {
          id: true, rating: true, theme: true, comment: true, learnerId: true,
          cohort: { select: { code: true } }, session: { select: { title: true } },
        },
        orderBy: [{ rating: "asc" }, { createdAt: "desc" }],
      }),
    ]);

  return [
    ...courses.map((c) =>
      item("course", c.id, c.name, `${c.code} · ${c.region} · ${lower(c.status)}`, [c.code, c.region, c.track])),
    ...cohorts.map((c) =>
      item("cohort", c.id, c.code, `${c.name} · ${c.enrolledLearners} learners · ${lower(c.health)}`, [c.name, c.course.name, lower(c.status), lower(c.health)])),
    ...instructors.map((i) =>
      item("instructor", i.id, i.name, `Instructor · ${i.expertise.split(",").slice(0, 3).join(", ")} · ${lower(i.hiringStage)}`, [i.email, i.expertise, i.region, lower(i.hiringStage)])),
    ...smes.map((s) =>
      item("sme", s.id, s.name, `SME · ${s.domain} · ${s.company}`, [s.email, s.domain, s.company, lower(s.hiringStage)])),
    ...modules.map((m) =>
      item("module", m.id, m.title, `${m.course.code} · ${lower(m.stage)} · ${m.ownerName}`, [m.course.code, m.ownerName, lower(m.stage)])),
    ...sessions.map((s) =>
      item("session", s.id, s.title, `${s.cohort.code} · ${day(s.scheduledAt)} · ${s.instructor.name}`, [s.cohort.code, s.instructor.name, lower(s.status)])),
    ...issues.map((i) =>
      item("issue", i.id, `${i.code} ${i.title}`, `${lower(i.severity)} · ${lower(i.status)} · ${i.ownerName ?? "unassigned"}`, [i.code, lower(i.category), lower(i.severity), lower(i.status), i.ownerName])),
    ...projects.map((p) =>
      item("project", p.id, p.title, `${p.cohort.code} · ${lower(p.type)} · ${lower(p.status)}`, [p.cohort.code, lower(p.type), lower(p.status)])),
    ...launches.map((l) =>
      item("launch", l.id, l.name, `${l.course.code} · ${day(l.targetDate)} · ${lower(l.status)}`, [l.course.code, l.ownerName, lower(l.status)])),
    ...feedback.map((f) =>
      item("feedback", f.id, truncate(f.comment, 80), `${f.rating}★ · ${f.theme} · ${f.cohort.code} · ${f.session.title}`, [f.theme, f.cohort.code, f.learnerId, f.session.title])),
  ];
}

/** Resolve a `focus=<type>:<id>` param to a display item, or null if it doesn't exist. */
export async function getFocusedEntity(focus: string | undefined): Promise<SearchItem | null> {
  if (!focus) return null;
  const [type, id] = focus.split(":");
  if (!type || !id || !(type in ENTITY_LABELS)) return null;
  const index = await getSearchIndex();
  return index.find((i) => i.type === type && i.id === id) ?? null;
}
