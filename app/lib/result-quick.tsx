"use client";
// app/lib/result-quick.tsx — ワンクリック合否記録（本日付）。記録後にトースト＋再描画。

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addResultAction } from "@/app/actions";
import { toast } from "@/app/lib/toast";

const OPTS = [
  { s: "pass", label: "合格", color: "var(--ok-solid)", key: "p" },
  { s: "fail", label: "不合格", color: "var(--bad-solid)", key: "f" },
  { s: "blocked", label: "ブロック", color: "var(--warn-solid)", key: "b" },
] as const;

export function ResultQuickButtons({ recordId, today }: { recordId: string; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function record(status: string, label: string) {
    const fd = new FormData();
    fd.set("recordId", recordId);
    fd.set("status", status);
    fd.set("executedAt", today);
    startTransition(async () => {
      try {
        await addResultAction(fd);
        router.refresh();
        toast(`${label}を記録しました`);
      } catch (e) {
        toast(e instanceof Error ? e.message : "記録に失敗しました", "error");
      }
    });
  }

  // キーボードショートカット: p=合格 / f=不合格 / b=ブロック（入力欄フォーカス中は無効）。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const opt = OPTS.find((o) => o.key === e.key);
      if (opt) {
        e.preventDefault();
        record(opt.s, opt.label);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, today]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] text-muted">今日の結果を記録</span>
      {OPTS.map((o) => (
        <button
          key={o.s}
          type="button"
          disabled={pending}
          onClick={() => record(o.s, o.label)}
          title={`${o.label}（${o.key}）`}
          className={`rounded-md px-3 py-1 text-[12px] font-semibold ${pending ? "opacity-60" : ""}`}
          style={{ background: o.color, color: "var(--on-color)" }}
        >
          {o.label}
        </button>
      ))}
      <span className="text-[11px] text-faint">p 合格 / f 不合格 / b ブロック</span>
    </div>
  );
}
