// app/login/page.tsx — ログイン（decisions/0018）。未ログインはここへ誘導される。
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { loginAction } from "@/app/auth-actions";
import { Logo } from "@/app/lib/logo";

export const dynamic = "force-dynamic";

export default async function LoginPage({
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
          <h1 className="mb-1 text-[17px] font-semibold">おかえりなさい</h1>
          <p className="mb-5 text-[12px] text-muted">メールとパスワードでサインインしてください。</p>

          {error ? (
            <p className="mb-4 rounded-lg border border-[#5b2a2a] bg-[#2a1614] px-3 py-2 text-[13px] text-[#ff8a7a]">
              メールアドレスまたはパスワードが違います。
            </p>
          ) : null}

          <form action={loginAction} className="space-y-3">
            <input name="email" type="email" required placeholder="メールアドレス" className="field" autoComplete="email" />
            <input name="password" type="password" required placeholder="パスワード" className="field" autoComplete="current-password" />
            <button className="btn-primary mt-1 w-full py-2.5 text-[14px]">ログイン</button>
          </form>
        </div>

        <p className="mt-5 text-center text-[12px] text-muted">
          アカウントがない？{" "}
          <a href="/signup" className="font-medium text-accent hover:underline">新規登録</a>
        </p>
      </div>
    </main>
  );
}
