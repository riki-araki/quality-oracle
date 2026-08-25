"use client";
// app/lib/command-trigger.tsx — サイドバーの検索ボタン。⌘K パレットを開く。

import { Icon } from "@/app/lib/icons";

export function CommandTrigger() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("open-command"))}
      className="flex w-full items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-[12px] text-muted hover:border-accent hover:text-ink"
    >
      <Icon name="search" size={14} className="shrink-0" />
      <span>検索…</span>
      <kbd className="ml-auto rounded border border-line bg-panel2 px-1.5 py-0.5 text-[10px] text-faint">⌘K</kbd>
    </button>
  );
}
