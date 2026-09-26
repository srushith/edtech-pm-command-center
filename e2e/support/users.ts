// People in the end-to-end tests. e2e/support/seed-db.ts creates the shared workspace and invites;
// playwright.config.ts makes OWNER the only ALLOWED_EMAILS admin on the test server.
export type Role = "owner" | "editor" | "viewer";
export type E2EUser = { email: string; name: string; first: string };

const user = (email: string, name: string): E2EUser => ({ email, name, first: name.split(" ")[0] });

/** Signs up through onboarding with demo data (an ALLOWED_EMAILS admin, no workspace yet). */
export const OWNER = user("owner@e2e.test", "Olivia Owner");
/** Owns SHARED_WORKSPACE (seeded, with demo data) and invited the editor and viewer. */
export const LEAD = user("lead@e2e.test", "Lee Lead");
export const EDITOR = user("editor@e2e.test", "Eddie Editor");
export const VIEWER = user("viewer@e2e.test", "Vic Viewer");
/** Owner-level member of SHARED_WORKSPACE, used by the responsive smoke test. */
export const LAYOUT = user("layout@e2e.test", "Lana Layout");
/** Neither admin, member nor invitee. */
export const STRANGER = user("stranger@e2e.test", "Sam Stranger");

export const SHARED_WORKSPACE = "Shared programs";
