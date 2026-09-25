// Auth.js: Google sign-in, invite-only, JWT sessions.
//
// JWT rather than database sessions because the auth Session table would collide with
// the class Session model. Access is still re-checked per request: requireWorkspace()
// looks up the membership every time, so removing a member takes effect immediately.
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import { isSignInAllowed } from "@/lib/auth/access";
import { saveGoogleGrant } from "@/lib/google/sheets";

export const { handlers, auth, signIn, signOut } = NextAuth({
  // The adapter is typed against @prisma/client; ours is generated to lib/generated.
  adapter: PrismaAdapter(db as unknown as Parameters<typeof PrismaAdapter>[0]),
  providers: [Google], // reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin" },
  // Needed behind `next start` and most hosts; the host header is set by our own server/proxy.
  trustHost: true,
  events: {
    // Keep the latest Google tokens and granted scopes (e.g. Sheets access added later).
    async signIn({ account }) {
      if (account) await saveGoogleGrant(account);
    },
  },
  callbacks: {
    async signIn({ user, profile }) {
      if (profile && profile.email_verified !== true) return false;
      const email = profile?.email ?? user.email;
      return !!email && (await isSignInAllowed(email));
    },
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      return session;
    },
  },
});
