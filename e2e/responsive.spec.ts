// Layout smoke test at desktop, laptop, tablet and phone widths: no page scrolls sideways or logs
// a console error, the sidebar can be used to reach a section (the rail at 768px and up, a sheet
// below), and the ⌘K palette fits in the window.
import { expect, test } from "@playwright/test";
import { expectNoErrors, expectNoHorizontalScroll, expectSection, FOOTER_NAV, MAIN_NAV, sidebar, signIn, watchPage } from "./support/app";
import { LAYOUT } from "./support/users";

// Below this width the sidebar is a sheet behind the "Toggle Sidebar" button (CSS `md:`).
const MOBILE_BELOW = 768;
const WIDTHS = [1440, 1024, 768, 390];
const PAGES = [...MAIN_NAV, ...FOOTER_NAV, { title: "Import", path: "/import" }];

for (const width of WIDTHS) {
  test(`layout at ${width}px`, async ({ page }) => {
    const watched = watchPage(page);
    await page.setViewportSize({ width, height: width < MOBILE_BELOW ? 844 : 900 });
    await signIn(page, LAYOUT);

    for (const { title, path } of PAGES) {
      await test.step(`${path}: no horizontal scroll, no console errors`, async () => {
        const before = { console: watched.consoleErrors.length, page: watched.pageErrors.length };
        await page.goto(path);
        await expectSection(page, title, path);
        await page.waitForLoadState("networkidle"); // hydration errors are logged once the client takes over
        await expectNoHorizontalScroll(page, `${path} at ${width}px`);
        expect.soft(watched.consoleErrors.slice(before.console), `console errors on ${path} at ${width}px`).toEqual([]);
        expect.soft(watched.pageErrors.slice(before.page), `uncaught errors on ${path} at ${width}px`).toEqual([]);
      });
    }

    await test.step("sidebar is usable", async () => {
      await page.goto("/");
      await expectSection(page, "Command Center", "/");
      // The top-bar button (the rail has the same label). Exactly one once the page settles.
      const toggles = page.locator('[data-sidebar="trigger"]');
      await expect.soft(toggles, "one sidebar toggle in the top bar").toHaveCount(1);
      const toggle = toggles.first();
      await expect(toggle).toBeVisible();

      if (width < MOBILE_BELOW) {
        // Hidden until opened; opens as a sheet, navigates, and closes again.
        await expect(sidebar(page)).toHaveCount(0);
        await toggle.click();
      }
      const nav = sidebar(page);
      await expect(nav).toBeVisible();
      for (const { title } of [...MAIN_NAV, ...FOOTER_NAV]) {
        await expect(nav.getByRole("link", { name: title, exact: true })).toBeInViewport();
      }
      // Labels readable, not clipped to icons.
      const box = await nav.boundingBox();
      expect(box?.width ?? 0, "sidebar width").toBeGreaterThanOrEqual(200);
      if (width < MOBILE_BELOW) expect(box?.width ?? 0, "sheet fits the screen").toBeLessThanOrEqual(width);
      await expectNoHorizontalScroll(page, `open sidebar at ${width}px`);

      await nav.getByRole("link", { name: "Launches", exact: true }).click();
      await expectSection(page, "Launches", "/launches");
      // On a phone the sheet should get out of the way once you've picked a section.
      if (width < MOBILE_BELOW) await expect(sidebar(page), "mobile sidebar closes after navigating").toHaveCount(0);
    });

    // 900px high at every width, then a short window: the list scrolls, the footer stays on screen.
    for (const height of [900, 500]) {
      await test.step(`⌘K opens and fits in a ${width}×${height} window`, async () => {
        await page.setViewportSize({ width, height });
        // The shortcut listener attaches on hydration, which can finish after "networkidle": retry the key.
        const palette = page.getByRole("dialog", { name: "Command palette" });
        await expect(async () => {
          if (!(await palette.isVisible())) await page.keyboard.press("Control+K");
          await expect(palette).toBeVisible({ timeout: 1_000 });
        }).toPass();
        await expect(palette.getByRole("option").first()).toBeVisible();
        await expect.soft(palette, "the whole palette, footer included, is on screen").toBeInViewport({ ratio: 1 });
        await expect.soft(palette.getByText("esc close"), "footer hints visible").toBeInViewport({ ratio: 1 });
        const list = palette.locator("[cmdk-list]");
        const { scrollHeight, clientHeight } = await list.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
        if (scrollHeight > clientHeight) {
          // Anything that doesn't fit is reachable by scrolling the list itself.
          await list.evaluate((el) => el.scrollTo(0, el.scrollHeight));
          await expect.soft(palette.getByRole("option").last(), "last result reachable by scrolling").toBeInViewport();
        }
        await page.keyboard.press("Escape");
        await expect(palette).toBeHidden();
      });
    }

    expectNoErrors(watched);
  });
}
