// PM vs Leadership view. The cookie holds the user's preference; `?mode=` in the URL
// overrides it for that page view only (for sharing a leadership link) and never
// writes the cookie. Safe to import from client and server.
export const MODES = ["pm", "leadership"] as const;
export type Mode = (typeof MODES)[number];
export const MODE_COOKIE = "cc-mode";
export const MODE_PARAM = "mode";
export const MODE_LABELS: Record<Mode, string> = { pm: "PM", leadership: "Leadership" };

export function parseMode(value: string | null | undefined): Mode | null {
  return MODES.includes(value as Mode) ? (value as Mode) : null;
}

export function resolveMode(urlValue: string | null | undefined, cookieValue: string | null | undefined): Mode {
  return parseMode(urlValue) ?? parseMode(cookieValue) ?? "pm";
}
