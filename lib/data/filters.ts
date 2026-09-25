import type { WorkspaceContext } from "@/lib/auth/access";
import { scopedDb } from "@/lib/data/scoped";
import type { RegionCode } from "@/lib/filters";

export type FilterOptions = {
  courses: { code: string; name: string; region: RegionCode }[];
  cohorts: { code: string; name: string; courseCode: string; region: RegionCode }[];
};

export async function getFilterOptions(ctx: WorkspaceContext): Promise<FilterOptions> {
  const db = scopedDb(ctx);
  const [courses, cohorts] = await Promise.all([
    db.course.findMany({ select: { code: true, name: true, region: true }, orderBy: { code: "asc" } }),
    db.cohort.findMany({
      select: { code: true, name: true, course: { select: { code: true, region: true } } },
      orderBy: [{ startDate: "desc" }],
    }),
  ]);
  return {
    courses,
    cohorts: cohorts.map((c) => ({ code: c.code, name: c.name, courseCode: c.course.code, region: c.course.region })),
  };
}
