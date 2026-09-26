import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_URL_HEADER } from "@/lib/request-url";

// Optimistic check only: no session cookie means straight to /signin. The real check
// (valid session + workspace membership) runs server-side in requireWorkspace().
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export function proxy(request: NextRequest) {
  // Large JWTs are chunked into "<name>.0", "<name>.1", ...
  const hasSession = request.cookies.getAll().some((c) => SESSION_COOKIES.some((n) => c.name === n || c.name.startsWith(`${n}.`)));
  if (hasSession) {
    // Always set here, so a client can't choose what the shell first renders.
    const headers = new Headers(request.headers);
    headers.set(REQUEST_URL_HEADER, request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.next({ request: { headers } });
  }
  const url = new URL("/signin", request.url);
  const from = request.nextUrl.pathname + request.nextUrl.search;
  if (from !== "/") url.searchParams.set("from", from);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the sign-in page, Auth.js routes and static assets.
  matcher: ["/((?!signin|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
