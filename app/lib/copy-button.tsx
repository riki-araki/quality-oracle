"use client";
// app/lib/copy-button.tsx — テキストをクリップボードにコピーしてトースト表示。

import type { ReactNode } from "react";
import { toast } from "@/app/lib/toast";

export function CopyButton({
  text,
  children,
  className = "btn-ghost",
}: {
  text: string;
  children: ReactNode;
  className?: string;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast("コピーしました");
    } catch {
      toast("コピーに失敗しました", "error");
    }
  }
  return (
    <button type="button" onClick={copy} className={className}>
      {children}
    </button>
  );
}
