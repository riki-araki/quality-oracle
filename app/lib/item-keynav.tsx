"use client";
// app/lib/item-keynav.tsx — 項目詳細で ← → キーで前後の項目へ移動（連続消化を速くする）。
// 入力欄にフォーカスがある時は無効。表示は持たない。

import { useEffect } from "react";

export function ItemKeyNav({ prev, next }: { prev: string | null; next: string | null }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === "ArrowLeft" && prev) window.location.href = `/item/${prev}`;
      else if (e.key === "ArrowRight" && next) window.location.href = `/item/${next}`;
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next]);
  return null;
}
