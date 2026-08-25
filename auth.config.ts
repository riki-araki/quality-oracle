// auth.config.ts — Edge セーフな Auth.js 設定（DB を読まない部分。decisions/0018）。
// proxy.ts（ルート保護）はこの設定だけを使う。Credentials の authorize（DB照合）は
// auth.ts 側に置く（node:sqlite は Edge で動かないため分離する）。

import type { NextAuthConfig } from "next-auth";

// 認証なしでも到達できる公開パス。
const PUBLIC_PREFIXES = ["/login", "/signup"];

export const authConfig = {
  // 自己ホスト前提。next start / ホスティング時に Host を信頼する（dev は自動信頼）。
  // これが無いと本番で /api/auth/session が UntrustedHost エラーになる。
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [], // 実体は auth.ts で注入する。
  callbacks: {
    // proxy（ルート保護）で呼ばれる。未ログインは signIn ページへリダイレクトされる。
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = request.nextUrl;
      const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
      if (isPublic) return true;
      return isLoggedIn;
    },
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = typeof token.uid === "string" ? token.uid : "";
        session.user.role = token.role === "admin" ? "admin" : "member";
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
