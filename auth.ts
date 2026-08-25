// auth.ts — Auth.js v5 本体（decisions/0018）。Credentials(メール+パスワード)で認証する。
// authorize() だけが台帳(node:sqlite)を読む。ルートハンドラ側で実行され Node ランタイム。

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { openLedger } from "@/app/lib/db";
import { verifyPassword } from "@/src/engine/password";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize(raw) {
        const email = String(raw?.email ?? "").trim().toLowerCase();
        const password = String(raw?.password ?? "");
        if (!email || !password) return null;
        const ledger = openLedger();
        try {
          const u = ledger.getUserAuth(email);
          if (!u || !verifyPassword(password, u.passwordHash)) return null;
          ledger.touchUser(u.id); // 最終ログイン時刻を更新
          return { id: u.id, email: u.email, name: u.name, role: u.role };
        } finally {
          ledger.close();
        }
      },
    }),
  ],
});
