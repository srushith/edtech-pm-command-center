import type { WorkspaceContext } from "@/lib/auth/access";
import { scopedDb } from "@/lib/data/scoped";
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
const tags = (csv: string) => csv.split(",").join(", ");

function item(
  type: EntityType,
  id: string,
  label: string,
  sublabel: string,
  fields: Record<string, string | null | undefined>,
): SearchItem {
  return {
    type,
    id,
    label,
    sublabel,
    fields: Object.entries(fields)
      .filter((f): f is [string, string] => !!f[1])
      .map(([name, text]) => ({ name, text })),
    href: `${sectionById(ENTITY_SECTION[type]).href}?focus=${type}:${id}`,
  };
}

/**
 * Every searchable entity in the current workspace, flattened for the ⌘K palette. The dataset is a few
 * hundred rows, so the palette loads it once and matches client-side with
 * lib/search.ts (portable across SQLite/Postgres, no case-sensitivity differences).
 * `fields` holds the searchable text that isn't in the label or sublabel.
 */
export async function getSearchIndex(ctx: WorkspaceContext): Promise<SearchItem[]> {
  const db = scopedDb(ctx);
  const [courses, cohorts, instructors, smes, modules, sessions, issues, projects, launches, feedback] =
    await Promise.all([
      db.course.findMany({
        select: { id: true, code: true, name: true, description: true, region: true, track: true, status: true },
        orderBy: { code: "asc" },
      }),
      db.cohort.findMany({
        select: { id: true, code: true, name: true, status: true, health: true, enrolledLearners: true, course: { select: { name: true } } },
        orderBy: { code: "asc" },
      }),
      db.instructor.findMany({ select: { id: true, name: true, email: true, expertise: true, region: true, hiringStage: true }, orderBy: { name: "asc" } }),
      db.sME.findMany({ select: { id: true, name: true, email: true, domain: true, company: true, hiringStage: true }, orderBy: { name: "asc" } }),
      db.module.findMany({
        select: { id: true, title: true, description: true, tags: true, stage: true, ownerName: true, course: { select: { code: true, name: true } } },
        orderBy: [{ courseId: "asc" }, { order: "asc" }],
      }),
      db.session.findMany({
        select: {
          id: true, title: true, scheduledAt: true, status: true,
          cohort: { select: { code: true } }, instructor: { select: { name: true } },
          sme: { select: { name: true } }, module: { select: { tags: true } },
        },
        orderBy: { scheduledAt: "desc" },
      }),
      db.issue.findMany({
        select: {
          id: true, code: true, title: true, description: true, category: true, severity: true, status: true, ownerName: true,
          cohort: { select: { code: true } },
        },
        orderBy: { code: "asc" },
      }),
      db.project.findMany({
        select: { id: true, title: true, description: true, type: true, status: true, cohort: { select: { code: true } } },
        orderBy: { dueDate: "asc" },
      }),
      db.launch.findMany({
        select: { id: true, name: true, status: true, ownerName: true, targetDate: true, course: { select: { code: true } } },
        orderBy: { targetDate: "asc" },
      }),
      // Lowest ratings first, so the most actionable comments lead their group.
      db.learnerFeedback.findMany({
        select: {
          id: true, rating: true, theme: true, comment: true, learnerId: true,
          cohort: { select: { code: true } }, session: { select: { title: true } },
        },
        orderBy: [{ rating: "asc" }, { createdAt: "desc" }],
      }),
    ]);

  return [
    ...courses.map((c) =>
      item("course", c.id, c.name, `${c.code} · ${c.region} · ${lower(c.status)}`, { Description: c.description, Track: c.track })),
    ...cohorts.map((c) =>
      item("cohort", c.id, c.code, `${c.name} · ${c.enrolledLearners} learners · ${lower(c.health)}`, { Course: c.course.name, Status: lower(c.status) })),
    ...instructors.map((i) =>
      item("instructor", i.id, i.name, `Instructor · ${tags(i.expertise)} · ${lower(i.hiringStage)}`, { Email: i.email, Region: i.region })),
    ...smes.map((s) =>
      item("sme", s.id, s.name, `SME · ${s.domain} · ${s.company}`, { Email: s.email, Stage: lower(s.hiringStage) })),
    ...modules.map((m) =>
      item("module", m.id, m.title, `${m.course.code} · ${lower(m.stage)} · ${m.ownerName}`, { Description: m.description, Tags: tags(m.tags), Course: m.course.name })),
    ...sessions.map((s) =>
      item("session", s.id, s.title, `${s.cohort.code} · ${day(s.scheduledAt)} · ${s.instructor.name}`, {
        Topics: s.module && tags(s.module.tags), "Guest SME": s.sme?.name, Status: lower(s.status),
      })),
    ...issues.map((i) =>
      item("issue", i.id, `${i.code} ${i.title}`, `${lower(i.severity)} · ${lower(i.status)} · ${i.ownerName ?? "unassigned"}`, {
        Description: i.description, Category: lower(i.category), Cohort: i.cohort?.code,
      })),
    ...projects.map((p) =>
      item("project", p.id, p.title, `${p.cohort.code} · ${lower(p.type)} · ${lower(p.status)}`, { Brief: p.description })),
    ...launches.map((l) =>
      item("launch", l.id, l.name, `${l.course.code} · ${day(l.targetDate)} · ${lower(l.status)}`, { Owner: l.ownerName })),
    ...feedback.map((f) =>
      item("feedback", f.id, f.comment, `${f.rating}★ · ${f.theme} · ${f.cohort.code} · ${f.session.title}`, { Learner: f.learnerId })),
  ];
}

/** Resolve a `focus=<type>:<id>` param to a display item, or null if it doesn't exist. */
export async function getFocusedEntity(ctx: WorkspaceContext, focus: string | undefined): Promise<SearchItem | null> {
  if (!focus) return null;
  const [type, id] = focus.split(":");
  if (!type || !id || !(type in ENTITY_LABELS)) return null;
  const index = await getSearchIndex(ctx);
  return index.find((i) => i.type === type && i.id === id) ?? null;
}
