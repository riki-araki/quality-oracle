// app/page.tsx — ダッシュボード（Project → 課題 → 項目テーブル）。
// 項目はテーブルで一覧（行クリックで詳細へ）。判断と証跡は詳細画面で行う（✓スルー対策と整合）。

import { redirect } from "next/navigation";
import { openLedger } from "@/app/lib/db";
import { Sidebar } from "@/app/lib/sidebar";
import { saveIssueAction, saveKnowledgeAction, analyzeKnowledgeAction, driftCheckAction, resolveDriftAction } from "@/app/actions";
import { buildTree, sortForReview } from "@/app/lib/model";
import { currentUser, accessibleProjectKeys, filterTree } from "@/app/lib/access";
import { PageHeader } from "@/app/lib/page-header";
import { SubmitButton } from "@/app/lib/submit-button";
import { PERSPECTIVE_LABEL, INTENSITY_LABEL } from "@/app/lib/ui";
import { ItemsTable } from "@/app/lib/items-table";
import type { ItemRow } from "@/app/lib/items-table";
import { EmptyState } from "@/app/lib/empty-state";
import { Icon } from "@/app/lib/icons";
import { Markdown } from "@/app/lib/markdown";
import type { DriftFinding, LedgerRecord, ResultStatus } from "@/src/engine/schema";
import type { IssueNode, ProjectNode } from "@/app/lib/model";

function IdentityFields({ issue, project }: { issue: IssueNode; project: ProjectNode }) {
  return (
    <>
      <input type="hidden" name="id" value={issue.id} />
      <input type="hidden" name="projectKey" value={project.key} />
      <input type="hidden" name="projectLabel" value={project.label} />
      <input type="hidden" name="sourceKind" value={issue.kind} />
      <input type="hidden" name="sourceRef" value={issue.sourceRef ?? ""} />
      <input type="hidden" name="createdAt" value={issue.createdAt} />
    </>
  );
}

const sectionLabel = "text-[11px] font-semibold uppercase tracking-[0.06em] text-muted";
const editLink = "cursor-pointer text-[12px] text-muted hover:text-ink";

// 課題のソース（gh:owner/repo#123 / gh:owner/repo:path[@ref]）→ GitHub URL。
function githubUrl(sourceRef: string | null): { url: string; label: string } | null {
  if (!sourceRef || !sourceRef.startsWith("gh:")) return null;
  const body = sourceRef.slice(3);
  const pr = body.match(/^([^/\s]+\/[^/\s#]+)#(\d+)$/);
  if (pr) return { url: `https://github.com/${pr[1]}/pull/${pr[2]}`, label: `PR #${pr[2]}` };
  const file = body.match(/^([^/\s]+\/[^:\s]+):([^@\s]+)(?:@(.+))?$/);
  if (file) {
    const ref = file[3] ?? "HEAD";
    return { url: `https://github.com/${file[1]}/blob/${ref}/${file[2]}`, label: file[2]! };
  }
  return null;
}

const DRIFT_SEV_LABEL: Record<string, string> = { high: "重大", med: "中", low: "軽微" };
const DRIFT_SEV_VAR: Record<string, string> = { high: "var(--bad-solid)", med: "var(--warn-solid)", low: "var(--border-strong)" };

// 意図ドリフト（§6.2⑥・decisions/0022）: 承認済み意図と現在コードの矛盾を検出・対応する。
function DriftPanel({
  issue,
  findings,
  specTitles,
  specCount,
  canReObserve,
}: {
  issue: IssueNode;
  findings: DriftFinding[];
  specTitles: Record<string, string>;
  specCount: number;
  canReObserve: boolean;
}) {
  const hasFindings = findings.length > 0;
  return (
    <details className="card group mt-3" open={hasFindings}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-[9px] text-faint transition-transform group-open:rotate-90">▶</span>
        <span className={sectionLabel}>意図ドリフト</span>
        {hasFindings ? (
          <span className="rounded-full bg-bad-soft px-1.5 py-0.5 text-[10px] font-semibold text-bad">{findings.length}</span>
        ) : (
          <span className="text-[11px] text-faint">検出なし</span>
        )}
        <span className="ml-auto text-[11px] text-faint">承認済みの意図 {specCount} 件と現状を照合</span>
      </summary>
      <div className="space-y-3 border-t border-line px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          {canReObserve ? (
            <form action={driftCheckAction}>
              <input type="hidden" name="issueId" value={issue.id} />
              <input type="hidden" name="target" value={issue.sourceRef ?? ""} />
              <SubmitButton
                className="inline-flex items-center gap-1 rounded-md border border-line bg-accent-soft px-2.5 py-1 text-[12px] text-accent hover:border-accent"
                pendingText="検査中…"
              >
                <Icon name="activity" size={13} /> ドリフトを検査
              </SubmitButton>
            </form>
          ) : (
            <p className="text-[12px] text-faint">
              {specCount === 0
                ? "まず項目を承認（✓/✗）して採用すると、その意図を基準に検査できます。"
                : "このソースは UI から再観測できません（標準入力由来）。CLI で検査してください。"}
            </p>
          )}
          <span className="text-[11px] text-faint">現在のコードを再観測し、承認済みの意図と矛盾する新挙動を洗い出します。</span>
        </div>

        {hasFindings ? (
          <ul className="space-y-2.5">
            {findings.map((f) => (
              <li key={f.id} className="rounded-lg border border-line bg-panel2/40 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-on-color"
                    style={{ background: DRIFT_SEV_VAR[f.severity] }}
                  >
                    {DRIFT_SEV_LABEL[f.severity] ?? f.severity}
                  </span>
                  <span className="font-mono text-[12px] text-ink">{f.anchor}</span>
                  {specTitles[f.specRecordId] ? (
                    <span className="text-[11px] text-faint">項目「{specTitles[f.specRecordId]}」</span>
                  ) : null}
                </div>
                <div className="space-y-1.5 text-[13px]">
                  <p className="text-muted">
                    <span className="text-faint">承認済みの意図: </span>
                    {f.approvedIntent}
                  </p>
                  <p className="text-ink">
                    <span className="text-faint">現状の挙動: </span>
                    {f.newObservation}
                  </p>
                  <p className="rounded-md bg-bad-soft px-2 py-1 text-bad">{f.contradiction}</p>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <form action={resolveDriftAction}>
                    <input type="hidden" name="id" value={f.id} />
                    <input type="hidden" name="decision" value="update" />
                    <SubmitButton className="btn-ghost !py-1 !text-[12px]" pendingText="更新中…">
                      新挙動を正とする（意図を更新）
                    </SubmitButton>
                  </form>
                  <form action={resolveDriftAction}>
                    <input type="hidden" name="id" value={f.id} />
                    <input type="hidden" name="decision" value="dismiss" />
                    <SubmitButton className="text-[12px] text-muted hover:text-ink" pendingText="…">
                      無視
                    </SubmitButton>
                  </form>
                  <span className="text-[11px] text-faint">
                    回帰バグなら放置＝この意図のテストが落ちるべき／仕様変更なら「意図を更新」。
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

function IssueMeta({ issue, project }: { issue: IssueNode; project: ProjectNode }) {
  const src = githubUrl(issue.sourceRef);
  return (
    <div className="mt-4 space-y-3">
      {src ? (
        <a
          href={src.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel2 px-2.5 py-1 text-[12px] text-muted no-underline hover:border-accent hover:text-ink"
        >
          <Icon name="external" size={13} />
          GitHub: <span className="font-mono text-ink">{src.label}</span>
        </a>
      ) : null}
      {/* 概要（主役・全幅） */}
      <div className="card p-5">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <span className={sectionLabel}>概要</span>
        </div>
        {issue.overview ? (
          <Markdown text={issue.overview} />
        ) : (
          <p className="text-[13px] text-faint">未設定。下の「編集」から背景・対象・狙いを追加できます。</p>
        )}
        <details className="group mt-3">
          <summary className={`${editLink} inline-flex w-fit list-none items-center gap-1 [&::-webkit-details-marker]:hidden`}>
            <span className="text-[9px] text-faint transition-transform group-open:rotate-90">▶</span>
            編集
          </summary>
          <div className="mt-2.5 rounded-lg border border-line bg-panel2/50 p-3.5">
            <form action={saveIssueAction} className="space-y-3">
              <IdentityFields issue={issue} project={project} />
              <div>
                <label className="mb-1 block text-[11px] font-medium text-faint">タイトル</label>
                <input name="title" defaultValue={issue.label} className="field" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-faint">概要（Markdown 可）</label>
                <textarea name="overview" rows={6} defaultValue={issue.overview ?? ""} placeholder="この課題の背景・対象・狙いなど" className="field resize-y" />
              </div>
              <SubmitButton className="btn-primary" pendingText="保存中…">保存</SubmitButton>
            </form>
          </div>
        </details>
      </div>

      {/* AI分析ナレッジ（使用頻度が低いので既定で折りたたみ） */}
      <details className="card group">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span className="text-[9px] text-faint transition-transform group-open:rotate-90">▶</span>
          <span className={sectionLabel}>AI分析ナレッジ</span>
          {issue.knowledge ? (
            <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">あり</span>
          ) : (
            <span className="text-[11px] text-faint">未設定</span>
          )}
          <span className="ml-auto text-[11px] text-faint">観測時に前提知識として注入</span>
        </summary>
        <div className="border-t border-line px-4 py-3.5">
          <div className="mb-2.5 flex items-center justify-end">
            <form action={analyzeKnowledgeAction}>
              <IdentityFields issue={issue} project={project} />
              <input type="hidden" name="title" value={issue.label} />
              <input type="hidden" name="overview" value={issue.overview ?? ""} />
              <SubmitButton
                className="inline-flex items-center gap-1 rounded-md border border-line bg-accent-soft px-2.5 py-1 text-[12px] text-accent hover:border-accent"
                pendingText="分析中…"
              >
                AIで下書き
              </SubmitButton>
            </form>
          </div>
          {issue.knowledge ? (
            <div className="max-h-80 overflow-auto pr-1">
              <Markdown text={issue.knowledge} />
            </div>
          ) : (
            <p className="text-[13px] text-faint">未設定。「AIで下書き」または下の「手で編集」で。育てるほど質問の精度が上がります。</p>
          )}
          <details className="mt-3">
            <summary className={editLink}>手で編集</summary>
            <form action={saveKnowledgeAction} className="mt-2.5 space-y-2">
              <IdentityFields issue={issue} project={project} />
              <input type="hidden" name="title" value={issue.label} />
              <input type="hidden" name="overview" value={issue.overview ?? ""} />
              <textarea name="knowledge" rows={8} defaultValue={issue.knowledge ?? ""} placeholder="箇条書き（マークダウン）で前提知識を…" className="field resize-y font-mono text-[12px]" />
              <SubmitButton className="btn-ghost" pendingText="保存中…">保存</SubmitButton>
            </form>
          </details>
        </div>
      </details>
    </div>
  );
}

export const dynamic = "force-dynamic";

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

function ResultSummary({
  records,
  results,
}: {
  records: LedgerRecord[];
  results: Record<string, ResultStatus>;
}) {
  let pass = 0;
  let fail = 0;
  let blocked = 0;
  let none = 0;
  for (const r of records) {
    const s = results[r.id];
    if (s === "pass") pass++;
    else if (s === "fail") fail++;
    else if (s === "blocked") blocked++;
    else none++;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
      <span className="text-muted">テスト項目 <b className="text-ink">{records.length}</b></span>
      <span className="text-muted">合格 <b className="text-ok">{pass}</b></span>
      <span className="text-muted">不合格 <b className="text-bad">{fail}</b></span>
      {blocked > 0 ? <span className="text-muted">ブロック <b className="text-warn">{blocked}</b></span> : null}
      <span className="text-muted">未実施 <b>{none}</b></span>
    </div>
  );
}

export default async function Page({
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
    const selProject = tree.find((x) => x.id === p) ?? tree[0];
    const selIssue = selProject?.issues.find((x) => x.id === i) ?? selProject?.issues[0];
    const items = selIssue ? sortForReview(selIssue.records) : [];
    const adopted = items.filter((r) => r.adopted);
    const candidates = items.filter((r) => !r.adopted);
    const adoptedIds = adopted.map((r) => r.id);
    const evCounts = selIssue ? ledger.evidenceCounts(adoptedIds) : {};
    const results = selIssue ? ledger.latestResults(adoptedIds) : {};
    const resultMeta = selIssue ? ledger.latestResultMeta(adoptedIds) : {};
    const userNames: Record<string, string> = selIssue
      ? Object.fromEntries(ledger.listUsers().map((u) => [u.id, u.name]))
      : {};
    const members = selProject
      ? ledger.listMembers(selProject.key).map((m) => ({ id: m.userId, name: userNames[m.userId] ?? m.userId }))
      : [];
    const today = new Date().toISOString().slice(0, 10);

    // 意図ドリフト（§6.2⑥・decisions/0022）: 承認済み意図の件数・open な検出・項目名の対応表。
    const driftSpecs = adopted.filter(
      (r) => r.declaredIntent && (r.status === "confirmed" || r.status === "corrected")
    );
    const driftFindings = selIssue ? ledger.listDriftFindings(selIssue.id, "open") : [];
    const specTitles: Record<string, string> = Object.fromEntries(
      adopted.map((r) => [r.id, r.generatedTest ? r.generatedTest.title : r.question])
    );
    const canReObserve = driftSpecs.length > 0 && !!selIssue?.sourceRef;

    const rows: ItemRow[] = adopted.map((r) => ({
      id: r.id,
      title: r.generatedTest ? r.generatedTest.title : r.question,
      anchor: r.anchor,
      track: r.track,
      kind: r.generatedTest ? r.generatedTest.kind : null,
      priority: r.priority,
      assignee: r.assignee,
      ev: evCounts[r.id] ?? 0,
      result: resultMeta[r.id] ?? null,
    }));

    return (
      <div className="flex">
        <Sidebar tree={tree} activeProjectId={selProject?.id} activeIssueId={selIssue?.id} />
        <main className="h-screen flex-1 overflow-y-auto">
          {!selIssue ? (
            <div className="mx-auto max-w-2xl p-6">
              <EmptyState
                icon={<Icon name="folder" size={22} />}
                title={selProject ? "まだ課題がありません" : "プロジェクトがありません"}
                description={
                  selProject
                    ? "課題（PR / ファイル / 範囲）を立てると、観測 → 候補 → テスト項目を作りはじめられます。"
                    : "まずプロジェクトを作成し、GitHub リポジトリを連携して課題を立てましょう。"
                }
                action={
                  selProject ? (
                    <a
                      href={`/issue/new?projectKey=${encodeURIComponent(selProject.key)}&p=${selProject.id}`}
                      className="btn-primary no-underline"
                    >
                      <Icon name="plus" size={14} /> 課題を立てる
                    </a>
                  ) : (
                    <a href="/project/new" className="btn-primary no-underline"><Icon name="plus" size={14} /> プロジェクトを作成</a>
                  )
                }
              />
            </div>
          ) : (
            <div className="mx-auto max-w-4xl p-6">
              <PageHeader
                eyebrow={selProject?.label}
                title={selIssue.label}
                actions={
                  <>
                    <a href={`/api/export/issue/${selIssue.id}`} className="btn-ghost no-underline">
                      <Icon name="download" size={14} /> Excel出力
                    </a>
                    <a href={`/add?p=${selProject?.id}&i=${selIssue.id}`} className="btn-primary no-underline">
                      <Icon name="plus" size={14} /> 項目を追加{candidates.length > 0 ? `（候補 ${candidates.length}）` : ""}
                    </a>
                  </>
                }
              />
              {items[0] ? (
                <div className="-mt-2 mb-3 flex flex-wrap items-center gap-2 text-[12px] text-muted">
                  <Pill>{PERSPECTIVE_LABEL[items[0].perspective]}</Pill>
                  <Pill>{INTENSITY_LABEL[items[0].intensity]}</Pill>
                </div>
              ) : null}

              <IssueMeta issue={selIssue} project={selProject!} />

              {driftSpecs.length > 0 || driftFindings.length > 0 ? (
                <DriftPanel
                  issue={selIssue}
                  findings={driftFindings}
                  specTitles={specTitles}
                  specCount={driftSpecs.length}
                  canReObserve={canReObserve}
                />
              ) : null}

              <div className="mt-4 border-b border-line pb-3">
                <ResultSummary records={adopted} results={results} />
              </div>

              <h2 className="mt-5 mb-2 text-[13px] font-semibold text-muted">
                テスト項目（{adopted.length}）
              </h2>
              {adopted.length > 0 ? (
                <ItemsTable rows={rows} userNames={userNames} today={today} currentUserId={user.id} members={members} />
              ) : (
                <EmptyState
                  icon={<Icon name="flask" size={22} />}
                  title="まだテスト項目がありません"
                  description="「項目を追加」で観測 → 候補を出し、採用するとここに並びます。"
                  action={
                    <a href={`/add?p=${selProject?.id}&i=${selIssue.id}`} className="btn-primary no-underline">
                      <Icon name="plus" size={14} /> 項目を追加{candidates.length > 0 ? `（候補 ${candidates.length}）` : ""}
                    </a>
                  }
                />
              )}
            </div>
          )}
        </main>
      </div>
    );
  } finally {
    ledger.close();
  }
}
