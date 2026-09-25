import { cookies } from "next/headers";
import { MODE_COOKIE, MODE_PARAM, parseMode, resolveMode, type Mode } from "@/lib/mode";

export async function getModeCookie(): Promise<Mode | null> {
  return parseMode((await cookies()).get(MODE_COOKIE)?.value);
}

/** Effective mode for a page: `?mode=` override, else cookie, else PM. */
export async function getMode(searchParams: Record<string, string | string[] | undefined>): Promise<Mode> {
  const raw = searchParams[MODE_PARAM];
  return resolveMode(Array.isArray(raw) ? raw[0] : raw, await getModeCookie());
}
