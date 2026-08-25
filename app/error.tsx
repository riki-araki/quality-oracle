"use client";
// app/error.tsx — ルートセグメントのエラーバウンダリ（Next.js App Router）。
// 実PR検証などで起きがちな一時失敗（LLM応答ゆらぎ・GitHub取得・レート制限・JSON解析失敗）を
// 素のクラッシュにせず、原因表示＋「もう一度試す」で復帰できるようにする。

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 開発時のデバッグ用。実データは外に出さない（ローカルログのみ）。
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="card w-full max-w-lg p-6 text-center">
        <h1 className="text-lg font-semibold text-ink">問題が発生しました</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          処理中にエラーが発生しました。多くは一時的なもの（AIの応答ゆらぎ・GitHub取得・レート制限・出力の解析失敗）です。
          もう一度試すと成功することがあります。
        </p>
        {error.message ? (
          <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-panel2 p-3 text-left text-[12px] text-bad">
            {error.message}
          </pre>
        ) : null}
        <div className="mt-4 flex items-center justify-center gap-2">
          <button onClick={() => reset()} className="btn-primary">もう一度試す</button>
          <a href="/" className="btn-ghost no-underline">ホームへ</a>
        </div>
        {error.digest ? <p className="mt-3 text-[11px] text-faint">digest: {error.digest}</p> : null}
      </div>
    </main>
  );
}
