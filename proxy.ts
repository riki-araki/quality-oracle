// proxy.ts — Next.js 16 のルート保護（旧 middleware.ts。decisions/0018）。
// Edge セーフな authConfig だけを使い、未ログインを /login にリダイレクトする。
// Credentials の DB 照合は含めない（auth.ts 側＝Node ランタイム）。

import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // api/auth（認証API）と静的アセットは保護対象から除外。
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
