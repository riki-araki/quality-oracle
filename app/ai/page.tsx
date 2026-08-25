// app/ai/page.tsx — AI使用状況ダッシュボード（管理者のみ・decisions/0021）。
// LLM 呼び出しの回数・トークン・概算コストを、種別/モデル/ユーザー/プロジェクト別に集計する。
// 記録は callModel の一点集約（pipeline.ts）を通り、ledger.ai_usage に貯まる。

import { redirect } from "next/navigation";
import { openLedger } from "@/app/lib/db";
import { Sidebar } from "@/app/lib/sidebar";
import { buildTree } from "@/app/lib/model";
import { PageHeader } from "@/app/lib/page-header";
import { EmptyState } from "@/app/lib/empty-state";
import { relativeTime } from "@/app/lib/relative-time";
import { currentUser } from "@/app/lib/access";
import type { AiUsage, AiUsageKind } from "@/src/engine/schema";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<AiUsageKind, string> = {
  observe: "観測 (Pass1)",
  interrogate: "尋問 (Pass2)",
  normal: "正常系生成",
  testgen: "テスト生成 (Pass3)",
  knowledge: "AI分析ナレッジ",
  request: "リクエスト下書き",
  drift: "意図ドリフト検査",
  lessons: "訂正の資産化",
};

// モデル別の概算単価（USD / 100万トークン）。最新は docs.claude.com を確認（記憶に頼らない）。
// 一致しないモデルは Sonnet 相当で概算する。
const PRICING: { match: RegExp; in: number; out: number }[] = [
  { match: /haiku/i, in: 1, out: 5 },
  { match: /opus/i, in: 15, out: 75 },
  { match: /sonnet/i, in: 3, out: 15 },
];
const DEFAULT_PRICE = { in: 3, out: 15 };

function priceFor(model: string) {
  return PRICING.find((p) => p.match.test(model)) ?? DEFAULT_PRICE;
}
function costOf(u: { model: string; inputTokens: number; outputTokens: number }): number {
  const p = priceFor(u.model);
  return (u.inputTokens * p.in + u.outputTokens * p.out) / 1_000_000;
}

interface Agg {
  calls: number;
  input: number;
  output: number;
  cost: number;
}
function emptyAgg(): Agg {
  return { calls: 0, input: 0, output: 0, cost: 0 };
}
function add(a: Agg, u: AiUsage): void {
  a.calls += 1;
  a.input += u.inputTokens;
  a.output += u.outputTokens;
  a.cost += costOf(u);
}

const fmt = (n: number) => n.toLocaleString("en-US");
const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

export default async function AiUsagePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/"); // 管理者のみ（横断集計）。

  const ledger = openLedger();
  try {
    const tree = buildTree(ledger.listProjects(), ledger.listIssues(), ledger.listRecords({}));
    const rows = ledger.listAiUsage();

    const userName = new Map(ledger.listUsers().map((u) => [u.id, u.name]));
    const projectLabel = new Map(ledger.listProjects().map((p) => [p.key, p.label]));

    const total = emptyAgg();
    const byKind = new Map<string, Agg>();
    const byModel = new Map<string, Agg>();
    const byUser = new Map<string, Agg>();
    const byProject = new Map<string, Agg>();
    for (const r of rows) {
      add(total, r);
      const push = (m: Map<string, Agg>, k: string) => {
        const a = m.get(k) ?? emptyAgg();
        add(a, r);
        m.set(k, a);
      };
      push(byKind, r.kind);
      push(byModel, r.model);
      push(byUser, r.userId ?? "");
      push(byProject, r.projectKey ?? "");
    }

    const sortByCost = (m: Map<string, Agg>) => [...m.entries()].sort((a, b) => b[1].cost - a[1].cost);
    const recent = rows.slice(0, 40);

    const metaLabel = "text-[11px] font-semibold uppercase tracking-[0.06em] text-muted";

    return (
      <div className="flex">
        <Sidebar tree={tree} />
        <main className="h-screen flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl p-6">
            <PageHeader
              eyebrow="管理"
              title="AI使用状況"
              subtitle="LLM 呼び出しの回数・トークン・概算コスト。核（観測と問い）が何にどれだけ使われているかを可視化する。"
            />

            {rows.length === 0 ? (
              <EmptyState
                title="まだAIの使用記録がありません"
                description="観測・尋問・テスト生成などを実行すると、ここに集計されます。"
              />
            ) : (
              <div className="space-y-4">
                {/* サマリ指標 */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: "総呼び出し", value: fmt(total.calls) },
                    { label: "入力トークン", value: fmt(total.input) },
                    { label: "出力トークン", value: fmt(total.output) },
                    { label: "概算コスト", value: usd(total.cost) },
                  ].map((s) => (
                    <div key={s.label} className="card px-4 py-3">
                      <div className={metaLabel}>{s.label}</div>
                      <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{s.value}</div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-faint">
                  コストは概算です（単価: Sonnet ${DEFAULT_PRICE.in}/${DEFAULT_PRICE.out} per 1M・入力/出力）。正確な請求は Anthropic
                    コンソールを確認してください。
                </p>

                {/* 種別別 */}
                <AggTable title="種別別" nameOf={(k) => KIND_LABEL[k as AiUsageKind] ?? k} rows={sortByCost(byKind)} metaLabel={metaLabel} />

                {/* モデル別 */}
                <AggTable title="モデル別" nameOf={(k) => k || "(不明)"} mono rows={sortByCost(byModel)} metaLabel={metaLabel} />

                {/* ユーザー別 */}
                <AggTable
                  title="ユーザー別"
                  nameOf={(k) => (k ? userName.get(k) ?? k : "（未ログイン/CLI）")}
                  rows={sortByCost(byUser)}
                  metaLabel={metaLabel}
                />

                {/* プロジェクト別 */}
                <AggTable
                  title="プロジェクト別"
                  nameOf={(k) => (k ? projectLabel.get(k) ?? k : "（未割当）")}
                  rows={sortByCost(byProject)}
                  metaLabel={metaLabel}
                />

                {/* 直近の呼び出し */}
                <div className="card overflow-hidden">
                  <div className="border-b border-line px-4 py-3">
                    <span className={metaLabel}>直近の呼び出し（最新40件）</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                          <th className="px-4 py-2 font-medium">時刻</th>
                          <th className="px-4 py-2 font-medium">種別</th>
                          <th className="px-4 py-2 font-medium">ユーザー</th>
                          <th className="px-4 py-2 text-right font-medium">入力</th>
                          <th className="px-4 py-2 text-right font-medium">出力</th>
                          <th className="px-4 py-2 text-right font-medium">概算</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recent.map((r) => (
                          <tr key={r.id} className="border-b border-line/60 last:border-0">
                            <td className="whitespace-nowrap px-4 py-2 text-muted">{relativeTime(r.createdAt)}</td>
                            <td className="px-4 py-2">{KIND_LABEL[r.kind] ?? r.kind}</td>
                            <td className="px-4 py-2 text-muted">{r.userId ? userName.get(r.userId) ?? r.userId : "—"}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-muted">{fmt(r.inputTokens)}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-muted">{fmt(r.outputTokens)}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{usd(costOf(r))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  } finally {
    ledger.close();
  }
}

// 集計テーブル（種別/モデル/ユーザー/プロジェクト共通）。コスト降順・棒付き。
function AggTable({
  title,
  rows,
  nameOf,
  mono,
  metaLabel,
}: {
  title: string;
  rows: [string, Agg][];
  nameOf: (key: string) => string;
  mono?: boolean;
  metaLabel: string;
}) {
  const maxCost = rows.reduce((m, [, a]) => Math.max(m, a.cost), 0.0001);
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <span className={metaLabel}>{title}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-4 py-2 font-medium">{title.replace("別", "")}</th>
              <th className="px-4 py-2 text-right font-medium">回数</th>
              <th className="px-4 py-2 text-right font-medium">入力</th>
              <th className="px-4 py-2 text-right font-medium">出力</th>
              <th className="px-4 py-2 text-right font-medium">概算</th>
              <th className="w-[22%] px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, a]) => (
              <tr key={key || "_"} className="border-b border-line/60 last:border-0">
                <td className={`px-4 py-2 ${mono ? "font-mono text-[12px]" : ""}`}>{nameOf(key)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted">{fmt(a.calls)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted">{fmt(a.input)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted">{fmt(a.output)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{usd(a.cost)}</td>
                <td className="px-4 py-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-chip">
                    <div style={{ width: `${(a.cost / maxCost) * 100}%`, background: "var(--accent)" }} className="h-full" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
