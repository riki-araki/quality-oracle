"use client";
// app/lib/items-table.tsx — 課題のテスト項目一覧（手動テスト向け）。
// フィルタ（結果状態）＋並び替え＋行から直接ワンクリック合否記録。行クリックで詳細へ。

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addResultAction, bulkRecordResultAction, bulkAssignAction } from "@/app/actions";
import { toast } from "@/app/lib/toast";
import {
  PRIORITY_LABEL,
  PRIORITY_COLOR,
  KIND_LABEL,
  TRACK_LABEL,
  shorten,
} from "@/app/lib/ui";
import { Icon } from "@/app/lib/icons";
import { ResultBadge } from "@/app/lib/result-badge";
import { Avatar } from "@/app/lib/avatar";

export interface ItemRow {
  id: string;
  title: string;
  anchor: string;
  track: "oracle" | "normal" | "manual" | "imported";
  kind: "regression" | "known_bug" | null;
  priority: "high" | "medium" | "low";
  assignee: string | null;
  ev: number;
  result: { status: "pass" | "fail" | "blocked"; executedAt: string; createdBy: string | null } | null;
}

const STATUS_FILTERS = [
  { k: "all", label: "すべて" },
  { k: "none", label: "未実施" },
  { k: "fail", label: "不合格" },
  { k: "pass", label: "合格" },
  { k: "blocked", label: "ブロック" },
] as const;

const SORTS = [
  { k: "priority", label: "優先度順" },
  { k: "result", label: "結果（要対応を上）" },
  { k: "stale", label: "未実施・古い順" },
] as const;

const PRIO_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const RES_RANK: Record<string, number> = { fail: 0, blocked: 1, none: 2, pass: 3 };

function Pill({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={color ? { background: color, color: "var(--on-color)" } : { background: "var(--chip)", color: "var(--chip-ink)" }}
    >
      {children}
    </span>
  );
}

const QUICK = [
  { s: "pass", label: "合", full: "合格", color: "var(--ok-solid)" },
  { s: "fail", label: "否", full: "不合格", color: "var(--bad-solid)" },
  { s: "blocked", label: "保", full: "ブロック", color: "var(--warn-solid)" },
] as const;

export function ItemsTable({
  rows,
  userNames,
  today,
  currentUserId,
  members,
}: {
  rows: ItemRow[];
  userNames: Record<string, string>;
  today: string;
  currentUserId: string;
  members: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("all");
  const [sort, setSort] = useState<string>("priority");
  const [mineOnly, setMineOnly] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, startBulk] = useTransition();
  const [, startTransition] = useTransition();

  const mineCount = useMemo(() => rows.filter((r) => r.assignee === currentUserId).length, [rows, currentUserId]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, none: 0, pass: 0, fail: 0, blocked: 0 };
    for (const r of rows) {
      const s = r.result?.status ?? "none";
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [rows]);

  const view = useMemo(() => {
    let xs = rows;
    if (mineOnly) xs = xs.filter((r) => r.assignee === currentUserId);
    if (filter !== "all") xs = xs.filter((r) => (r.result?.status ?? "none") === filter);
    return [...xs].sort((a, b) => {
      if (sort === "priority") return (PRIO_RANK[a.priority] ?? 1) - (PRIO_RANK[b.priority] ?? 1);
      if (sort === "result")
        return (RES_RANK[a.result?.status ?? "none"] ?? 2) - (RES_RANK[b.result?.status ?? "none"] ?? 2);
      // stale: 未実施を先頭、その後 実施日が古い順
      const ad = a.result?.executedAt ?? "";
      const bd = b.result?.executedAt ?? "";
      if (!ad && bd) return -1;
      if (ad && !bd) return 1;
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });
  }, [rows, filter, sort, mineOnly, currentUserId]);

  function quick(id: string, status: string, full: string, e: React.MouseEvent) {
    e.stopPropagation();
    setPendingId(id);
    const fd = new FormData();
    fd.set("recordId", id);
    fd.set("status", status);
    fd.set("executedAt", today);
    startTransition(async () => {
      try {
        await addResultAction(fd);
        router.refresh();
        toast(`${full}を記録しました`);
      } catch (err) {
        toast(err instanceof Error ? err.message : "記録に失敗しました", "error");
      } finally {
        setPendingId(null);
      }
    });
  }

  // —— 複数選択 ——
  const viewIds = view.map((r) => r.id);
  const allChecked = viewIds.length > 0 && viewIds.every((id) => selected.has(id));
  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected((s) => {
      const n = new Set(s);
      if (allChecked) viewIds.forEach((id) => n.delete(id));
      else viewIds.forEach((id) => n.add(id));
      return n;
    });
  }
  function clearSel() {
    setSelected(new Set());
  }
  function runBulk(fn: () => Promise<void>, msg: string) {
    const n = selected.size;
    startBulk(async () => {
      try {
        await fn();
        router.refresh();
        clearSel();
        toast(`${n}件: ${msg}`);
      } catch (err) {
        toast(err instanceof Error ? err.message : "一括操作に失敗しました", "error");
      }
    });
  }

  const cols = "grid grid-cols-[26px_72px_40px_minmax(0,1fr)_74px_92px_80px_100px] items-center gap-2.5";

  return (
    <div>
      {/* ツールバー: 結果フィルタ＋自分の担当＋並び替え */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.k}
            type="button"
            onClick={() => setFilter(f.k)}
            className={`rounded-full border px-2.5 py-1 text-[12px] ${
              filter === f.k
                ? "border-accent bg-accent-soft text-accent"
                : "border-line text-muted hover:border-accent hover:text-ink"
            }`}
          >
            {f.label} <span className="tabular-nums opacity-60">{counts[f.k] ?? 0}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setMineOnly((v) => !v)}
          className={`rounded-full border px-2.5 py-1 text-[12px] ${
            mineOnly ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:border-accent hover:text-ink"
          }`}
        >
          自分の担当 <span className="tabular-nums opacity-60">{mineCount}</span>
        </button>
        <div className="ml-auto flex items-center gap-1.5 text-[12px] text-muted">
          <span>並び</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="select"
          >
            {SORTS.map((s) => (
              <option key={s.k} value={s.k}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className={`${cols} border-b border-line bg-panel2/60 px-3 py-2.5 text-[11px] uppercase tracking-[0.06em] text-muted`}>
          <input
            type="checkbox"
            checked={allChecked}
            onChange={toggleAll}
            className="size-3.5 cursor-pointer accent-[var(--accent)]"
            title="表示中をすべて選択"
          />
          <span>結果</span>
          <span>優先</span>
          <span>項目 / テスト</span>
          <span>種別</span>
          <span>担当</span>
          <span>最終実施</span>
          <span className="text-right">証跡 / 記録</span>
        </div>

        {view.length === 0 ? (
          <p className="px-3 py-8 text-center text-[13px] text-muted">該当する項目はありません。</p>
        ) : (
          view.map((r) => (
            <div
              key={r.id}
              onClick={() => router.push(`/item/${r.id}`)}
              className={`group ${cols} cursor-pointer border-b border-line/70 px-3 py-2.5 text-[13px] transition-colors last:border-0 hover:bg-panel2/70 ${
                pendingId === r.id ? "opacity-60" : ""
              } ${selected.has(r.id) ? "bg-accent-soft/60" : ""}`}
            >
              <input
                type="checkbox"
                checked={selected.has(r.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggle(r.id)}
                className="size-3.5 cursor-pointer accent-[var(--accent)]"
              />
              <span>
                {r.result ? (
                  <ResultBadge status={r.result.status} />
                ) : (
                  <span className="text-[12px] text-faint">未実施</span>
                )}
              </span>
              <span><Pill color={PRIORITY_COLOR[r.priority]}>{PRIORITY_LABEL[r.priority]}</Pill></span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-ink" title={r.title}>{r.title}</span>
                  {r.track !== "oracle" ? (
                    <span className="shrink-0 rounded bg-panel2 px-1 text-[10px] text-muted">{TRACK_LABEL[r.track]}</span>
                  ) : null}
                </span>
                <span className="block truncate text-[11px] text-faint" title={r.anchor}>{shorten(r.anchor, 60)}</span>
              </span>
              <span>
                {r.kind ? (
                  <Pill color={r.kind === "known_bug" ? "var(--bad-solid)" : undefined}>{KIND_LABEL[r.kind]}</Pill>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-[12px]">
                {r.assignee ? (
                  <>
                    <Avatar name={userNames[r.assignee] ?? r.assignee} size={18} />
                    <span className="truncate text-ink" title={userNames[r.assignee] ?? r.assignee}>{userNames[r.assignee] ?? r.assignee}</span>
                  </>
                ) : (
                  <span className="text-faint">未割当</span>
                )}
              </span>
              <span className="text-[12px] tabular-nums text-muted">{r.result ? r.result.executedAt : "—"}</span>
              <span className="flex items-center justify-end gap-1">
                <span className="inline-flex items-center gap-1 text-muted group-hover:hidden">
                  {r.ev > 0 ? (
                    <>
                      <Icon name="paperclip" size={12} /> {r.ev}
                    </>
                  ) : (
                    "—"
                  )}
                </span>
                {/* hover で結果を直接記録 */}
                <span className="hidden items-center gap-1 group-hover:flex">
                  {QUICK.map((q) => (
                    <button
                      key={q.s}
                      type="button"
                      title={`${q.full}を記録`}
                      onClick={(e) => quick(r.id, q.s, q.full, e)}
                      className="grid size-6 place-items-center rounded-md text-[11px] font-bold"
                      style={{ background: q.color, color: "var(--on-color)" }}
                    >
                      {q.label}
                    </button>
                  ))}
                </span>
              </span>
            </div>
          ))
        )}
      </div>

      {/* 一括操作バー（選択時に出現） */}
      {selected.size > 0 ? (
        <div className={`fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2 shadow-[var(--shadow-pop)] ${bulkPending ? "opacity-70" : ""}`}>
          <span className="text-[13px] font-medium tabular-nums">{selected.size}件選択</span>
          <span className="h-5 w-px bg-line" />

          <span className="flex items-center gap-1.5">
            <span className="text-[12px] text-muted">合否</span>
            {QUICK.map((q) => (
              <button
                key={q.s}
                type="button"
                disabled={bulkPending}
                onClick={() => runBulk(() => bulkRecordResultAction([...selected], q.s), `${q.full}を記録`)}
                className="grid size-7 place-items-center rounded-md text-[11px] font-bold"
                style={{ background: q.color, color: "var(--on-color)" }}
                title={`選択を ${q.full} で記録`}
              >
                {q.label}
              </button>
            ))}
          </span>
          <span className="h-5 w-px bg-line" />

          <select
            value=""
            disabled={bulkPending}
            onChange={(e) => {
              const v = e.target.value;
              runBulk(() => bulkAssignAction([...selected], v === "__none" ? null : v), v === "__none" ? "担当を解除" : "担当を割当");
            }}
            className="select"
          >
            <option value="" disabled>担当を割当…</option>
            <option value="__none">未割当にする</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>

          <span className="h-5 w-px bg-line" />
          <button type="button" onClick={clearSel} className="text-[12px] text-muted hover:text-ink">
            選択解除
          </button>
        </div>
      ) : null}
    </div>
  );
}
