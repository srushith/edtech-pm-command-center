// Edit forms always show what's in the database (TESTING.md bug E2E-1), and a form that went
// stale can't overwrite someone else's newer save.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signIn, watchPage } from "./support/app";
import { LAYOUT, LEAD, type E2EUser } from "./support/users";

async function openAs(browser: Browser, user: E2EUser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const watched = watchPage(page);
  await signIn(page, user);
  await page.goto("/cohorts");
  await page.waitForLoadState("networkidle");
  return { page, watched, close: () => context.close() };
}

// Uncaught errors only: the console errors on these pages are bug E2E-2, reported by the journeys.
const expectNoPageErrors = (w: ReturnType<typeof watchPage>) => expect(w.pageErrors, "uncaught errors in the page").toEqual([]);

const cohortRow = (page: Page, code: string) =>
  page.getByRole("row").filter({ has: page.getByRole("cell", { name: code, exact: true }) });

async function addCohort(page: Page, code: string) {
  await page.getByRole("button", { name: "Add cohort" }).click();
  const add = page.getByRole("dialog", { name: "Add cohort" });
  await add.getByLabel("Course").selectOption({ index: 1 });
  await add.getByLabel("Code").fill(code);
  await add.getByLabel("Name").fill(`${code} original`);
  await add.getByLabel("Enrolled learners").fill("10");
  await add.getByRole("button", { name: /^Add cohort/ }).click();
  await expect(add).toBeHidden();
  await expect(cohortRow(page, code)).toContainText("10/60");
}

async function openEdit(page: Page, code: string) {
  await cohortRow(page, code).getByRole("button", { name: `Edit ${code}` }).click();
  const form = page.getByRole("dialog", { name: "Edit cohort" });
  await expect(form.getByLabel("Name")).toBeVisible();
  return form;
}

async function saveEdit(page: Page, form: ReturnType<Page["getByRole"]>) {
  await form.getByRole("button", { name: /^Save changes/ }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Saved cohort" })).toBeVisible();
}

test("reopening Edit shows the saved values, and a second edit keeps the first", async ({ browser }) => {
  const { page, watched, close } = await openAs(browser, LEAD);
  const code = "E2E-FRESH";
  await addCohort(page, code);

  // First edit: the name.
  let form = await openEdit(page, code);
  await form.getByLabel("Name").fill(`${code} first edit`);
  await saveEdit(page, form);

  // Reopen: the form shows it, then a second edit on another field.
  form = await openEdit(page, code);
  await expect(form.getByLabel("Name")).toHaveValue(`${code} first edit`);
  await form.getByLabel("Enrolled learners").fill("30");
  await saveEdit(page, form);
  await expect(cohortRow(page, code)).toContainText("30/60");

  // Both stuck, in the database: after a full page load, the form has both.
  await page.reload();
  form = await openEdit(page, code);
  await expect(form.getByLabel("Name")).toHaveValue(`${code} first edit`);
  await expect(form.getByLabel("Enrolled learners")).toHaveValue("30");

  expectNoPageErrors(watched);
  await close();
});

test("a form opened before someone else's save can't overwrite it, and Reload shows their change", async ({ browser }) => {
  const a = await openAs(browser, LEAD);
  const b = await openAs(browser, LAYOUT);
  const code = "E2E-CLASH";
  await addCohort(a.page, code);
  await b.page.reload();

  // A opens the form; B then changes the name and saves.
  const formA = await openEdit(a.page, code);
  const formB = await openEdit(b.page, code);
  await formB.getByLabel("Name").fill(`${code} changed by ${LAYOUT.first}`);
  await saveEdit(b.page, formB);

  // A's form is stale now: the save is refused, the form stays open, nothing is overwritten.
  await formA.getByLabel("Enrolled learners").fill("33");
  await formA.getByRole("button", { name: /^Save changes/ }).click();
  const conflict = formA.getByRole("alert");
  await expect(conflict).toContainText("This record was updated since you opened it");
  await expect(formA).toBeVisible();
  await b.page.reload();
  await expect(cohortRow(b.page, code)).toContainText("10/60");

  // Reload loads B's change; A redoes theirs and saves on top of it.
  await conflict.getByRole("button", { name: "Reload" }).click();
  await expect(formA.getByLabel("Name")).toHaveValue(`${code} changed by ${LAYOUT.first}`);
  await expect(formA.getByLabel("Enrolled learners")).toHaveValue("10");
  await formA.getByLabel("Enrolled learners").fill("33");
  await saveEdit(a.page, formA);

  const final = await openEdit(a.page, code);
  await expect(final.getByLabel("Name")).toHaveValue(`${code} changed by ${LAYOUT.first}`);
  await expect(final.getByLabel("Enrolled learners")).toHaveValue("33");

  expectNoPageErrors(a.watched);
  expectNoPageErrors(b.watched);
  await a.close();
  await b.close();
});
