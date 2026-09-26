// Helpers shared by the end-to-end specs.
import { expect, type Page } from "@playwright/test";
import type { E2EUser } from "./users";

// Same id as TEST_PROVIDER_ID in lib/auth/test-sign-in.ts (not imported: that module needs the database).
export const TEST_PROVIDER_ID = "test-login";

// Sidebar order from CLAUDE.md (lib/nav.ts). Kept literal here so the tests check the app against the spec.
export const MAIN_NAV = [
  { title: "Command Center", path: "/" },
  { title: "Cohorts", path: "/cohorts" },
  { title: "Courses", path: "/courses" },
  { title: "Curriculum", path: "/curriculum" },
  { title: "Instructor / SME Hub", path: "/talent" },
  { title: "Class Health", path: "/class-health" },
  { title: "Learner Voice", path: "/learner-voice" },
  { title: "Launches", path: "/launches" },
  { title: "Projects & Capstones", path: "/projects" },
  { title: "Operations", path: "/operations" },
  { title: "AI Insights", path: "/ai-insights" },
] as const;
export const FOOTER_NAV = [
  { title: "Data Integrity", path: "/data" },
  { title: "Settings", path: "/settings" },
] as const;

/**
 * Sign in through Auth.js's own credentials flow (CSRF token, then the provider callback), the
 * way a sign-in form would post it. Cookies land in the page's browser context. Returns where
 * Auth.js redirected: the callback URL, or /signin?error=… when the invite-only check says no.
 */
export async function signIn(page: Page, user: E2EUser, callbackUrl = "/"): Promise<string> {
  const csrf = await page.request.get("/api/auth/csrf");
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const res = await page.request.post(`/api/auth/callback/${TEST_PROVIDER_ID}`, {
    form: { csrfToken, email: user.email, name: user.name, callbackUrl },
    maxRedirects: 0,
  });
  expect(res.status(), "Auth.js answers the callback with a redirect").toBe(302);
  return res.headers()["location"] ?? "";
}

/** The visible sidebar: the desktop rail, or the mobile sheet once it's open. */
export const sidebar = (page: Page) => page.locator('[data-sidebar="sidebar"]:visible');

/**
 * Watch the page for uncaught errors and console errors, and hide the Next.js dev overlay:
 * under `next dev` its badge sits over the sidebar footer (the account menu). The errors it would
 * show are collected here instead; specs assert both lists are empty at the end.
 */
export function watchPage(page: Page): { pageErrors: string[]; consoleErrors: string[] } {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(`${new URL(page.url()).pathname}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = `${new URL(page.url()).pathname}: ${m.text().split("\n")[0]}`;
    if (!consoleErrors.includes(text)) consoleErrors.push(text);
  });
  void page.addInitScript(() => {
    const hide = () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal { display: none !important; }";
      document.head.appendChild(style);
    };
    if (document.head) hide();
    else document.addEventListener("DOMContentLoaded", hide);
  });
  return { pageErrors, consoleErrors };
}

/** End of a spec: no uncaught errors (hard) and no console errors (soft, so every one is listed). */
export function expectNoErrors({ pageErrors, consoleErrors }: ReturnType<typeof watchPage>) {
  expect.soft(consoleErrors, "console errors in the browser").toEqual([]);
  expect(pageErrors, "uncaught errors in the page").toEqual([]);
}

/**
 * The page must not scroll sideways. Soft, so one run lists every page and width that does;
 * the message names the outermost elements that stick out past the viewport.
 */
export async function expectNoHorizontalScroll(page: Page, where: string) {
  const { scrollWidth, clientWidth, culprits } = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.getAttribute("data-slot") ? `[data-slot=${el.getAttribute("data-slot")}]` : ""}` +
      `${el.getAttribute("aria-label") ? `[aria-label="${el.getAttribute("aria-label")}"]` : ""}` +
      ` (right edge ${Math.round(el.getBoundingClientRect().right)}px)`;
    const over = [...document.body.querySelectorAll("*")].filter((el) => el.getBoundingClientRect().right > clientWidth + 1);
    // Outermost only: skip elements whose parent already overflows.
    const outer = over.filter((el) => !el.parentElement || !over.includes(el.parentElement));
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth, culprits: outer.slice(0, 4).map(describe) };
  });
  expect
    .soft(scrollWidth, `${where}: page is ${scrollWidth}px wide in a ${clientWidth}px viewport. Sticking out: ${culprits.join("; ")}`)
    .toBeLessThanOrEqual(clientWidth);
}

/** A fresh page load finished rendering the dashboard shell (top bar title). */
export async function expectSection(page: Page, title: string, path: string) {
  await expect(page).toHaveURL((u) => u.pathname === path);
  await expect(page.locator("header h1")).toHaveText(title);
}

/** Open the account menu in the sidebar footer. */
export async function openAccountMenu(page: Page, user: E2EUser) {
  await sidebar(page).getByRole("button", { name: new RegExp(user.name) }).click();
  return page.getByRole("menu");
}
