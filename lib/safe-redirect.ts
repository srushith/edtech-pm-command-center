/** A same-origin path to return to after sign-in, or "/" (prevents open redirects). */
export function safeRedirect(from: unknown): string {
  return typeof from === "string" && from.startsWith("/") && !from.startsWith("//") && !from.startsWith("/\\") ? from : "/";
}
