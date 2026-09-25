// The mock dataset is anchored to a fixed "today" so it is deterministic and
// never drifts relative to the wall clock. Seed and checks both use this.
export const DEMO_TODAY = new Date("2026-09-25T00:00:00Z");

const DAY = 86_400_000;

/**
 * A cohort's end date is inclusive: sessions can run any time on that day.
 * Stored end dates are UTC midnight, so the window closes at the next midnight.
 */
export function inCohortWindow(at: Date, cohort: { startDate: Date; endDate: Date }): boolean {
  return at >= cohort.startDate && at.getTime() < cohort.endDate.getTime() + DAY;
}

/** "Now" for a record: demo rows live at DEMO_TODAY, everything else on the wall clock. */
export function nowFor(row: { isDemo: boolean }, now = new Date()): Date {
  return row.isDemo ? DEMO_TODAY : now;
}
