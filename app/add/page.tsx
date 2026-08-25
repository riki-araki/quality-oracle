// app/add/page.tsx — 項目作成（別画面）。観測フォームで候補を出し、候補ごとに採否を決める。
// 意図どおり→採用 / 違う→修正して採用 / 不採用→捨てる。採用したものだけが管理画面のテスト項目になる。

import { notFound, redirect } from "next/navigation";
import { openLedger } from "@/app/lib/db";
import { currentUser, accessibleProjectKeys, filterTree } from "@/app/lib/access";
import {
  observeAction,
  observeNormalAction,
  adoptAllNormalAction,
  curateAction,
  addManualAction,
  importJsonAction,
} from "@/app/actions";
import { buildTree, sortForReview, sortByInfo, isLowInfo } from "@/app/lib/model";
import { riskVar, shorten, TRACK_LABEL } from "@/app/lib/ui";
import { PageHeader } from "@/app/lib/page-header";
import { SubmitButton } from "@/app/lib/submit-button";
import { EmptyState } from "@/app/lib/empty-state";
import { Icon } from "@/app/lib/icons";
import type { LedgerRecord } from "@/src/engine/schema";

export const dynamic = "force-dynamic";

const inp = "w-full field";

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

function ObserveForm({ target, issueId }: { target: string | null; issueId: string }) {
  const sel = "select";
  if (!target) {
    return (
      <p className="card p-3 text-[13px] text-muted">
        この課題はソース未設定のため、UIからの観測はできません（課題のソースを設定するか CLI を使ってください）。
      </p>
    );
  }
  return (
    <form action={observeAction} className="flex flex-wrap items-center gap-2 card p-4">
      <span className="text-[13px] font-semibold">観点を出す：</span>
      <input type="hidden" name="target" value={target} />
      <input type="hidden" name="issueId" value={issueId} />
      <label className="text-[12px] text-muted">主体</label>
      <select name="perspective" className={sel} defaultValue="director">
        <option value="director">業務（ディレクター）</option>
        <option value="engineer">技術（エンジニア）</option>
      </select>
      <label className="text-[12px] text-muted">強度</label>
      <select name="intensity" className={sel} defaultValue="medium">
        <option value="loose">緩い</option>
        <option value="medium">中間</option>
        <option value="strong">強い</option>
      </select>
      <label className="flex items-center gap-1.5 text-[12px] text-muted">
        <input type="checkbox" name="regression" defaultChecked /> デグレ観点を強化
      </label>
      <SubmitButton pendingText="生成中…（十数秒）">オラクル質問を生成</SubmitButton>
      <SubmitButton formAction={observeNormalAction} className="btn-ghost" pendingText="生成中…（十数秒）">
        正常系を生成（観測ベース）
      </SubmitButton>
      <span className="w-full text-[11px] text-muted">
        ※「オラクル」＝リスク/意図の確認質問、「正常系」＝現状の挙動を固定する回帰項目。どちらも候補に並びます（十数秒）。
      </span>
    </form>
  );
}

const KIND_LABEL: Record<string, string> = {
  contradiction: "矛盾",
  omission: "抜け",
  precondition: "前提",
  boundary: "境界",
  behavior: "挙動",
};

function Candidate({ r, dim }: { r: LedgerRecord; dim?: boolean }) {
  const btn = "rounded-md border border-line px-2.5 py-1 text-[12px] transition-colors hover:border-accent";
  return (
    <div className={`card p-4 ${dim ? "opacity-70" : ""}`}>
      <div className="flex items-center gap-2">
        <Pill color={r.track === "normal" ? "var(--normal)" : "var(--oracle)"}>{TRACK_LABEL[r.track]}</Pill>
        <Pill color={riskVar(r.risk)}>{r.risk}</Pill>
        {r.track === "oracle" ? <Pill>{KIND_LABEL[r.kind] ?? r.kind}</Pill> : null}
        {r.generatedTest ? <Pill>{r.generatedTest.kind === "known_bug" ? "既知バグ" : "回帰"}</Pill> : null}
        {r.confidence === "low" ? <Pill color="var(--warn-solid)">⚠ 要確認</Pill> : null}
        <span className="ml-auto text-[12px] text-muted">{shorten(r.anchor, 44)}</span>
      </div>
      <div className="mt-2 text-[13px] text-muted">観測: {r.observation}</div>
      <p className="mt-1 font-semibold leading-relaxed">{r.question}</p>

      <div className="mt-3 flex flex-wrap items-start gap-2">
        {/* 意図どおり → 採用（現状を正解＝回帰） */}
        <form action={curateAction}>
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="decision" value="adopt" />
          <button className={`${btn} bg-ok-soft text-ok`}>意図どおり → 採用</button>
        </form>

        {/* 不採用 → 捨てる */}
        <form action={curateAction}>
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="decision" value="discard" />
          <button className={`${btn} bg-panel2 text-muted`}>不採用（捨てる）</button>
        </form>
      </div>

      {/* 違う → 修正して採用（観点＝意図を直す。既定はAI推測） */}
      <form action={curateAction} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={r.id} />
        <input type="hidden" name="decision" value="adopt_corrected" />
        <input
          name="intent"
          defaultValue={r.aiAssumption}
          placeholder="正しい意図に修正"
          className="min-w-[220px] flex-1 field"
        />
        <button className={`${btn} bg-bad-soft text-bad`}>違う → 修正して採用</button>
      </form>
    </div>
  );
}

export default async function AddPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; i?: string }>;
}) {
  const { p, i } = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login");
  const ledger = openLedger();
  try {
    const tree = filterTree(
      buildTree(ledger.listProjects(), ledger.listIssues(), ledger.listRecords({})),
      accessibleProjectKeys(ledger, user)
    );
    const project = tree.find((x) => x.id === p) ?? tree[0];
    const issue = project?.issues.find((x) => x.id === i) ?? project?.issues[0];
    if (!issue) notFound();
    const candidates = issue.records.filter((r) => !r.adopted);
    const normalPending = candidates.filter((r) => r.track === "normal").length;
    const target = issue.sourceRef ?? issue.records[0]?.codeRef.path ?? null;

    // 情報量順（decisions/0024）: オラクル質問は「当たりそうな順」に。鏡に近い低情報は畳んで下げる。
    const oracle = candidates.filter((r) => r.track === "oracle");
    const nonOracle = sortForReview(candidates.filter((r) => r.track !== "oracle"));
    const highInfo = sortByInfo(oracle.filter((r) => !isLowInfo(r)));
    const lowInfo = sortByInfo(oracle.filter((r) => isLowInfo(r)));

    return (
      <main className="h-screen overflow-y-auto">
        <div className="mx-auto max-w-3xl p-6">
          <PageHeader
            breadcrumb={[
              { label: project?.label ?? "", href: `/project?p=${project?.id}` },
              { label: issue.label, href: `/?p=${project?.id}&i=${issue.id}` },
            ]}
            title="テスト項目を追加"
            subtitle="観測→候補を出し、候補ごとに「採用 / 修正して採用 / 捨てる」を選びます。採用したものが課題のテスト項目になります。"
          />

          <div>
            <ObserveForm target={target} issueId={issue.id} />
          </div>

          <details className="mt-3 card">
            <summary className="cursor-pointer px-4 py-2 text-[13px] font-semibold">手動でテスト項目を追加</summary>
            <form action={addManualAction} className="space-y-2 px-4 pb-3">
              <input type="hidden" name="issueId" value={issue.id} />
              <input name="title" required placeholder="タイトル" className={inp} />
              <div className="grid gap-2 sm:grid-cols-3">
                <input name="given" placeholder="Given（前提）" className={inp} />
                <input name="when" placeholder="When（操作）" className={inp} />
                <input name="then" placeholder="Then（期待）" className={inp} />
              </div>
              <div className="flex flex-wrap gap-2">
                <input name="anchor" placeholder="対象（任意）" className={`${inp} flex-1`} />
                <select name="kind" className="select" defaultValue="regression">
                  <option value="regression">回帰</option>
                  <option value="known_bug">既知バグ</option>
                </select>
                <select name="risk" className="select" defaultValue="other">
                  {["money", "irreversible", "auth", "data", "critical", "other"].map((rk) => (
                    <option key={rk} value={rk}>{rk}</option>
                  ))}
                </select>
                <button className="btn-primary">追加（採用）</button>
              </div>
            </form>
          </details>

          <details className="mt-3 card">
            <summary className="cursor-pointer px-4 py-2 text-[13px] font-semibold">JSONインポート（実装者の取り込み用）</summary>
            <form action={importJsonAction} className="space-y-2 px-4 pb-3">
              <input type="hidden" name="issueId" value={issue.id} />
              <textarea
                name="json"
                rows={6}
                required
                placeholder={'[{"title":"…","given":"…","when":"…","then":"…","kind":"regression","risk":"other"}]'}
                className={`${inp} font-mono resize-y`}
              />
              <button className="btn-primary">取り込む（採用）</button>
              <p className="text-[11px] text-muted">配列。各要素は title 必須、given/when/then/anchor/kind(regression|known_bug)/risk は任意。種別＝「取込」で入ります。</p>
            </form>
          </details>

          <div className="mt-6 mb-2 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-muted">候補（{candidates.length}）</h2>
            {normalPending > 0 ? (
              <form action={adoptAllNormalAction}>
                <input type="hidden" name="issueId" value={issue.id} />
                <button className="rounded-md border border-line bg-ok-soft px-3 py-1 text-[12px] text-ok hover:border-accent">
                  正常系を全部採用（{normalPending}）
                </button>
              </form>
            ) : null}
          </div>
          {candidates.length > 0 ? (
            <div className="space-y-3">
              {highInfo.length > 0 ? (
                <p className="text-[11px] text-faint">
                  <Icon name="activity" size={12} className="mr-1 inline align-[-2px]" />
                  当たりそうな順（低確信・矛盾/抜け・高リスクを上に）。まずここを見てください。
                </p>
              ) : null}
              {highInfo.map((r) => (
                <Candidate key={r.id} r={r} />
              ))}

              {nonOracle.map((r) => (
                <Candidate key={r.id} r={r} />
              ))}

              {lowInfo.length > 0 ? (
                <details className="card group">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
                    <span className="text-[9px] text-faint transition-transform group-open:rotate-90">▶</span>
                    <span className="text-[12px] font-semibold text-muted">低情報（鏡に近い・AIが高確信の挙動）</span>
                    <span className="rounded-full bg-chip px-1.5 py-0.5 text-[10px] tabular-nums text-muted">{lowInfo.length}</span>
                    <span className="ml-auto text-[11px] text-faint">コードの言い換えに近く、承認予算をかける価値が低い候補</span>
                  </summary>
                  <div className="space-y-3 border-t border-line px-1 pt-3">
                    {lowInfo.map((r) => (
                      <Candidate key={r.id} r={r} dim />
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : (
            <EmptyState
              icon={<Icon name="search" size={22} />}
              title="候補はありません"
              description="上のフォームで「オラクル質問を生成」または「正常系を生成」すると、候補がここに並びます（手動追加・JSON取込も可）。"
            />
          )}
        </div>
      </main>
    );
  } finally {
    ledger.close();
  }
}
