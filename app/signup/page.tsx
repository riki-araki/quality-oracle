// app/signup/page.tsx — 新規登録（decisions/0018）。最初の登録者は admin になる。
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { signupAction } from "@/app/auth-actions";
import { Logo } from "@/app/lib/logo";

export const dynamic = "force-dynamic";

const ERR: Record<string, string> = {
  invalid: "メール・名前・パスワード（8文字以上）を確認してください。",
  exists: "このメールアドレスは既に登録されています。",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if ((await auth())?.user) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="relative flex h-screen items-center justify-center overflow-hidden p-6">
      <div className="pointer-events-none absolute left-1/2 top-1/3 size-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/15 blur-[120px]" />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <Logo size={28} />
          <span className="text-lg font-semibold tracking-tight">quality-oracle</span>
        </div>

        <div className="card p-6">
          <h1 className="mb-1 text-[17px] font-semibold">アカウントを作成</h1>
          <p className="mb-5 text-[12px] text-muted">最初に登録した人が管理者（admin）になります。</p>

          {error ? (
            <p className="mb-4 rounded-lg border border-[#5b2a2a] bg-[#2a1614] px-3 py-2 text-[13px] text-[#ff8a7a]">
              {ERR[error] ?? "登録に失敗しました。"}
            </p>
          ) : null}

          <form action={signupAction} className="space-y-3">
            <input name="name" required placeholder="表示名" className="field" autoComplete="name" />
            <input name="email" type="email" required placeholder="メールアドレス" className="field" autoComplete="email" />
            <input name="password" type="password" required placeholder="パスワード（8文字以上）" className="field" autoComplete="new-password" minLength={8} />
            <button className="btn-primary mt-1 w-full py-2.5 text-[14px]">登録してはじめる</button>
          </form>
        </div>

        <p className="mt-5 text-center text-[12px] text-muted">
          すでにアカウントがある？{" "}
          <a href="/login" className="font-medium text-accent hover:underline">ログイン</a>
        </p>
      </div>
    </main>
  );
}
