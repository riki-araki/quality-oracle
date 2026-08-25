"use client";
// app/lib/command-palette.tsx — ⌘K / Ctrl+K のコマンドパレット。
// プロジェクト/課題/項目を横断検索してジャンプ。layout に常設。
// sidebar 等から window イベント "open-command" でも開ける。

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/lib/icons";
import type { IconName } from "@/app/lib/icons";

interface NavItem {
  type: "project" | "issue" | "item";
  label: string;
  sub: string;
  href: string;
}

const TYPE_ICON: Record<NavItem["type"], IconName> = {
  project: "folder",
  issue: "fileText",
  item: "flask",
};

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NavItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K でトグル、Esc で閉じる、カスタムイベントでも開く。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command", onOpen);
    };
  }, []);

  // 開いたら索引を取得（一度だけ）＋フォーカス＆リセット。
  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    if (!loaded) {
      fetch("/api/search")
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d) => {
          setItems(d.items ?? []);
          setLoaded(true);
        })
        .catch(() => setLoaded(true));
    }
    return () => clearTimeout(id);
  }, [open, loaded]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s
      ? items.filter((it) => it.label.toLowerCase().includes(s) || it.sub.toLowerCase().includes(s))
      : items;
    return list.slice(0, 50);
  }, [q, items]);

  function go(it: NavItem) {
    setOpen(false);
    router.push(it.href);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
    >
      <div
        className="card w-full max-w-lg overflow-hidden shadow-[var(--shadow-pop)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Icon name="search" size={15} className="shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const it = results[active];
                if (it) go(it);
              }
            }}
            placeholder="プロジェクト・課題・項目を検索…"
            className="w-full bg-transparent py-3 text-[14px] text-ink outline-none placeholder:text-faint"
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-muted">{loaded ? "見つかりません" : "読み込み中…"}</p>
          ) : (
            results.map((it, i) => (
              <button
                key={it.href + i}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(it)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] ${
                  i === active ? "bg-accent-soft" : ""
                }`}
              >
                <Icon name={TYPE_ICON[it.type]} size={15} className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{it.label}</span>
                  <span className="block truncate text-[11px] text-faint">{it.sub}</span>
                </span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-[11px] text-faint">
          <span>↑↓ 移動</span>
          <span>↵ 開く</span>
          <span>esc 閉じる</span>
        </div>
      </div>
    </div>
  );
}
