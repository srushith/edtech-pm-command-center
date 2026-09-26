// Run by e2e/global-setup.ts (through tsx, against DATABASE_URL_TEST): wipe the test database,
// then create the workspace the invited editor and viewer land in.
import { db } from "@/lib/db";
import { inviteMember } from "@/lib/data/workspaces";
import { ctx, makeUser, makeWorkspace, resetDb } from "../../tests/helpers";
import { EDITOR, LAYOUT, LEAD, SHARED_WORKSPACE, VIEWER } from "./users";

async function main() {
  await resetDb();
  const lead = await makeUser(LEAD.email, LEAD.name);
  const layout = await makeUser(LAYOUT.email, LAYOUT.name);
  const ws = await makeWorkspace(lead.id, SHARED_WORKSPACE, { demo: true, members: [[layout.id, "OWNER"]] });
  const leadCtx = await ctx(lead.id, ws.id);
  await inviteMember(leadCtx, EDITOR.email, "EDITOR");
  await inviteMember(leadCtx, VIEWER.email, "VIEWER");
  await db.$disconnect();
  console.log(`e2e: test database reset; "${SHARED_WORKSPACE}" seeded with demo data and invites.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
