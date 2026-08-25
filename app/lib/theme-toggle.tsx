"use client";
// app/lib/theme-toggle.tsx — ライト/ダーク切替。html の .dark を付け外しして localStorage に保存。
// アイコンは CSS（dark: バリアント）で出し分けるので、ハイドレーション不整合が起きない。

import { Icon } from "@/app/lib/icons";

export function ThemeToggle() {
  function toggle() {
    const dark = document.documentElement.classList.toggle("dark");
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      /* localStorage 不可でも無視 */
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      title="テーマ切替（ライト/ダーク）"
      aria-label="テーマ切替"
      className="grid size-7 place-items-center rounded-lg border border-line text-muted hover:border-accent hover:text-accent"
    >
      <span className="dark:hidden"><Icon name="moon" size={15} /></span>
      <span className="hidden dark:block"><Icon name="sun" size={15} /></span>
    </button>
  );
}
