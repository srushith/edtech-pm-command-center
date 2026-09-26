// E2E-3 regression: the shell (sidebar, top bar with its filter bar and mode toggle) sits in Suspense
// boundaries that hydrate after the page body, so a link in the page can be clicked, and the router
// moved to another page, before the shell has hydrated. The shell must still hydrate against the page
// the server rendered (no "Hydration failed"), then show the new page. The Import link on /courses
// also drops the filters and the ?mode override, so the title, filter bar, mode toggle and sidebar
// links all change with it. Several rounds, since it's a race.
import { expect, test } from "@playwright/test";
import { expectNoErrors, sidebar, signIn, watchPage } from "./support/app";
import { LAYOUT } from "./support/users";

const ROUNDS = 5;

test("page link clicked before the shell hydrates: no hydration error, shell follows", async ({ page }) => {
  const watched = watchPage(page);
  await signIn(page, LAYOUT);

  for (let round = 1; round <= ROUNDS; round++) {
    await test.step(`round ${round}: /courses?region=US&mode=leadership → Import`, async () => {
      const before = { console: watched.consoleErrors.length, page: watched.pageErrors.length };
      await page.goto("/courses?region=US&mode=leadership");
      await page.getByRole("link", { name: "Import" }).click();
      await expect(page).toHaveURL(/\/import\?type=course$/);

      const header = page.locator("header");
      await expect(header.getByRole("heading", { level: 1 })).toHaveText("Import");
      await expect(header.getByRole("combobox", { name: "All regions" })).toHaveText(/^All regions/);
      await expect(header.getByRole("radio", { name: "PM" })).toHaveAttribute("aria-checked", "true");
      await expect(sidebar(page).getByRole("link", { name: "Courses", exact: true })).toHaveAttribute("href", "/courses");
      await expect(sidebar(page).locator('[data-sidebar="menu-button"][data-active]')).toHaveCount(0);

      await page.waitForLoadState("networkidle"); // hydration errors are logged once the client takes over
      expect.soft(watched.consoleErrors.slice(before.console), `console errors in round ${round}`).toEqual([]);
      expect.soft(watched.pageErrors.slice(before.page), `uncaught errors in round ${round}`).toEqual([]);
    });
  }

  expectNoErrors(watched);
});
