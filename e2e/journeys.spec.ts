// The main user journeys, once per role:
// sign in → onboarding with demo data (owner) or straight into the inviting workspace (editor,
// viewer) → every sidebar section → ⌘K search → add, edit, delete and Undo a cohort → import a
// CSV → sign out. Viewers get the same walk and must find no way to change anything.
import { expect, test, type Page } from "@playwright/test";
import {
  expectNoErrors,
  expectSection,
  FOOTER_NAV,
  MAIN_NAV,
  openAccountMenu,
  sidebar,
  signIn,
  watchPage,
} from "./support/app";
import { EDITOR, OWNER, SHARED_WORKSPACE, STRANGER, VIEWER, type E2EUser, type Role } from "./support/users";

type Journey = { role: Role; user: E2EUser; workspace: string; roleLabel: string; code: string };

const JOURNEYS: Journey[] = [
  { role: "owner", user: OWNER, workspace: `${OWNER.first}'s programs`, roleLabel: "Owner", code: "E2E-O" },
  { role: "editor", user: EDITOR, workspace: SHARED_WORKSPACE, roleLabel: "Editor", code: "E2E-E" },
  { role: "viewer", user: VIEWER, workspace: SHARED_WORKSPACE, roleLabel: "Viewer", code: "E2E-V" },
];

async function walkSidebar(page: Page) {
  // All 11 sections, in the CLAUDE.md order, then the footer links.
  await expect(sidebar(page).locator('[data-sidebar="content"] a')).toHaveText(MAIN_NAV.map((n) => n.title));
  for (const { title, path } of [...MAIN_NAV, ...FOOTER_NAV]) {
    await sidebar(page).getByRole("link", { name: title, exact: true }).click();
    await expectSection(page, title, path);
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  }
}

async function search(page: Page, canEdit: boolean) {
  await page.waitForLoadState("networkidle"); // the shortcut listener attaches on hydration
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  const input = palette.getByPlaceholder(/Search courses/);

  // Creating from ⌘K is for editors and owners.
  await input.fill("new cohort");
  await expect(palette.getByRole("option", { name: "New cohort…" })).toHaveCount(canEdit ? 1 : 0);

  await input.fill("agentic");
  const hit = palette.getByRole("option", { name: /Agentic AI/ }).first();
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(palette).toBeHidden();
  await expect(page).toHaveURL(/[?&]focus=/);
  const focused = page.getByRole("region", { name: "Focused record" });
  await expect(focused).toContainText("Opened from ⌘K");
  await expect(focused).not.toContainText("Record not found");
}

async function cohortLifecycle(page: Page, code: string) {
  await page.goto("/cohorts");
  const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: code, exact: true }) });

  // "C" opens Quick add for editors and owners (the viewer journey checks it doesn't for them).
  // The shortcut listener attaches on hydration, which can finish after "networkidle": retry the key.
  const quickAdd = page.getByRole("dialog", { name: "Quick add" });
  await expect(async () => {
    if (!(await quickAdd.isVisible())) await page.locator("body").press("c");
    await expect(quickAdd.getByRole("option", { name: "Cohort" })).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await page.keyboard.press("Escape");
  await expect(quickAdd).toBeHidden();

  // Add
  await page.getByRole("button", { name: "Add cohort" }).click();
  const add = page.getByRole("dialog", { name: "Add cohort" });
  await expect(add.getByLabel("Course")).toBeVisible();
  await add.getByLabel("Course").selectOption({ index: 1 });
  await add.getByLabel("Code").fill(code);
  await add.getByLabel("Name").fill(`${code} journey cohort`);
  await add.getByLabel("Enrolled learners").fill("20");
  await add.getByRole("button", { name: /^Add cohort/ }).click();
  await expect(add).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Added cohort" })).toBeVisible();
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("20/60");

  // Edit
  await row.getByRole("button", { name: `Edit ${code}` }).click();
  const edit = page.getByRole("dialog", { name: "Edit cohort" });
  await expect(edit.getByLabel("Name")).toHaveValue(`${code} journey cohort`);
  await edit.getByLabel("Name").fill(`${code} journey cohort (edited)`);
  await edit.getByLabel("Enrolled learners").fill("25");
  await edit.getByRole("button", { name: /^Save changes/ }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Saved cohort" })).toBeVisible();
  await expect(row).toContainText("25/60");
  // Reopening shows the saved values. Soft: the journey goes on, the test still fails.
  await row.getByRole("button", { name: `Edit ${code}` }).click();
  await expect(edit.getByLabel("Name")).toBeVisible();
  await expect.soft(edit.getByLabel("Name"), "reopened edit form shows the saved name").toHaveValue(`${code} journey cohort (edited)`);
  await edit.getByRole("button", { name: "Cancel" }).click();
  await expect(edit).toBeHidden();

  // Delete (a new cohort has nothing under it, so no typed confirmation)
  await row.getByRole("button", { name: `Delete ${code}` }).click();
  const del = page.getByRole("dialog", { name: /^Delete cohort/ });
  await expect(del).toContainText("It moves to Trash");
  await del.getByRole("button", { name: "Move to Trash" }).click();
  await expect(del).toBeHidden();
  const deleted = page.getByRole("status").filter({ hasText: "to Trash" });
  await expect(deleted).toBeVisible();
  await expect(row).toHaveCount(0);

  // Undo
  await deleted.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Restored" })).toBeVisible();
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("25/60");
}

async function viewerCantChangeCohorts(page: Page) {
  await page.goto("/cohorts");
  await expect(page.getByRole("heading", { name: /^Cohorts/, level: 3 })).toBeVisible();
  await expect(page.getByRole("row").nth(1)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add cohort" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  // "C" is Quick add for editors; nothing opens for a viewer. (The listener attaches on hydration.)
  await page.waitForLoadState("networkidle");
  await page.locator("body").press("c");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function importCsv(page: Page, journey: Journey) {
  const code = `${journey.code}-CSV`;
  const file = `e2e-${journey.role}-courses.csv`;
  await page.goto("/courses");
  await page.getByRole("link", { name: "Import" }).click();
  await expect(page).toHaveURL(/\/import\?type=course/);
  await expect(page.getByRole("radio", { name: "courses" })).toHaveAttribute("aria-checked", "true");

  await page.getByLabel("CSV file").setInputFiles({
    name: file,
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Code,Name,Region,Track,Status,Description\n" +
        `${code},${journey.roleLabel} journey course,US,AI,ACTIVE,Imported by the ${journey.role} journey\n`,
    ),
  });
  await expect(page.getByText(`${file}: 1 rows, 6 columns`)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Preview rows" }).click();
  await expect(page.getByRole("tab", { name: "New · 1" })).toBeVisible();
  await page.getByRole("button", { name: /^Import: 1 new/ }).click();
  await expect(page.getByText(new RegExp(`Imported from ${file}: 1 new, 0 updated`))).toBeVisible();

  await page.getByRole("link", { name: "View courses" }).click();
  await expect(page).toHaveURL(/\/courses$/);
  await expect(page.getByRole("row").filter({ hasText: code })).toContainText(`${journey.roleLabel} journey course`);
}

async function viewerCantImport(page: Page) {
  await page.goto("/courses");
  await expect(page.getByRole("heading", { name: /^Courses/, level: 3 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Import" })).toHaveCount(0);
  await page.goto("/import?type=course");
  await expect(page.getByText("Importing is for editors and owners.")).toBeVisible();
  await expect(page.getByLabel("CSV file")).toHaveCount(0);
}

for (const journey of JOURNEYS) {
  const { role, user } = journey;
  const canEdit = role !== "viewer";

  test(`${role} journey`, async ({ page }) => {
    const watched = watchPage(page);

    await test.step("signed out: the app asks you to sign in", async () => {
      await page.goto("/cohorts");
      await expect(page).toHaveURL(/\/signin\?from=%2Fcohorts/);
      await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    });

    await test.step("sign in", async () => {
      const to = await signIn(page, user);
      expect(to, "sign-in isn't refused").not.toContain("error=");
      await page.goto("/");
    });

    if (role === "owner") {
      await test.step("onboarding with demo data", async () => {
        await expect(page).toHaveURL(/\/onboarding$/);
        await expect(page.getByRole("heading", { name: `Welcome, ${user.first}` })).toBeVisible();
        await expect(page.getByLabel("Name your workspace")).toHaveValue(journey.workspace);
        await page.getByRole("button", { name: "Continue" }).click();
        await expect(page.getByRole("radio", { name: /Start with demo data/ })).toHaveAttribute("aria-checked", "true");
        await page.getByRole("button", { name: "Create workspace" }).click();
        await expect(page).toHaveURL((u) => u.pathname === "/", { timeout: 180_000 });
        await expectSection(page, "Command Center", "/");
      });
    } else {
      await test.step("invite accepted: straight into the shared workspace", async () => {
        await expectSection(page, "Command Center", "/");
      });
    }

    await test.step("account menu: who, which workspace, which role", async () => {
      const menu = await openAccountMenu(page, user);
      await expect(menu).toContainText(user.email);
      await expect(menu).toContainText(journey.workspace);
      await expect(menu).toContainText(journey.roleLabel);
      await expect(menu.getByRole("menuitem", { name: "Trash" })).toHaveCount(role === "owner" ? 1 : 0);
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
    });

    await test.step("navigate every sidebar section", () => walkSidebar(page));

    await test.step("⌘K search", () => search(page, canEdit));

    if (canEdit) {
      await test.step("add a cohort, edit it, delete it, Undo", () => cohortLifecycle(page, journey.code));
      await test.step("import a CSV", () => importCsv(page, journey));
    } else {
      await test.step("viewer: no add, edit, delete or quick add", () => viewerCantChangeCohorts(page));
      await test.step("viewer: import is for editors", () => viewerCantImport(page));
    }

    if (role === "owner") {
      await test.step("owner invites a colleague", async () => {
        await page.goto("/settings");
        await page.getByRole("textbox", { name: "Email" }).fill("new-hire@e2e.test");
        await page.getByRole("combobox", { name: "Role", exact: true }).selectOption("VIEWER");
        await page.getByRole("button", { name: "Invite" }).click();
        await expect(page.getByRole("listitem").filter({ hasText: "new-hire@e2e.test" })).toContainText("Viewer");
      });
    }

    await test.step("sign out", async () => {
      const menu = await openAccountMenu(page, user);
      await menu.getByRole("menuitem", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/\/signin/);
      await page.goto("/");
      await expect(page).toHaveURL(/\/signin/);
    });

    expectNoErrors(watched);
  });
}

test("sign-in stays invite-only with the test provider", async ({ page }) => {
  const to = await signIn(page, STRANGER);
  expect(to).toContain("error=AccessDenied");
  await page.goto(to);
  await expect(page.getByRole("alert")).toContainText("isn't invited");
  await page.goto("/");
  await expect(page).toHaveURL(/\/signin/);
});
