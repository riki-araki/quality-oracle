"use client";
// app/lib/tabs.tsx — クライアント側のタブ切替。中身（Server Componentのフォーム等）は
// props として受け取り、全タブをマウントしたまま表示/非表示で切り替える（フォーム状態を保つ）。

import { useState } from "react";
import type { ReactNode } from "react";

export function Tabs({ tabs }: { tabs: { label: string; content: ReactNode }[] }) {
  const [active, setActive] = useState(0);
  return (
    <div>
      <div className="mb-3 inline-flex rounded-md border border-line bg-panel2 p-0.5">
        {tabs.map((t, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActive(i)}
            className={`rounded-[5px] px-3 py-1 text-[13px] transition-colors ${
              i === active
                ? "bg-panel font-medium text-ink shadow-[var(--shadow-card)]"
                : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div key={i} style={{ display: i === active ? "block" : "none" }}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
