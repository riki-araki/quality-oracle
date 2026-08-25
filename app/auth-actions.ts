"use server";
// app/auth-actions.ts — 認証の Server Action（ログイン/サインアップ/ログアウト。decisions/0018）。

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { openLedger } from "@/app/lib/db";
import { hashPassword } from "@/src/engine/password";
import { hashKey } from "@/src/engine/issues";

export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
  } catch (e) {
    // 認証失敗のみここに来る（リダイレクトは NEXT_REDIRECT として再throwされる）。
    if (e instanceof AuthError) redirect("/login?error=1");
    throw e;
  }
}

export async function signupAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email.includes("@") || !name || password.length < 8) redirect("/signup?error=invalid");

  const ledger = openLedger();
  try {
    if (ledger.getUserAuth(email)) redirect("/signup?error=exists");
    // 最初の登録者を admin にする（ブートストラップ）。
    const role = ledger.countUsers() === 0 ? "admin" : "member";
    ledger.createUser({
      id: `u_${hashKey(email)}`,
      email,
      name,
      role,
      passwordHash: hashPassword(password),
    });
  } finally {
    ledger.close();
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
