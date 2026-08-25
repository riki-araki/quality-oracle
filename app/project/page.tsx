// app/project/page.tsx — プロジェクト・ダッシュボード。リポジトリ横断でテスト状況を可視化する。
// 採用済みテスト項目の 合格/不合格/ブロック/未実施、課題別、主体別を集計する。

import { notFound, redirect } from "next/navigation";
import { openLedger } from "@/app/lib/db";
import { Sidebar } from "@/app/lib/sidebar";
import { saveProjectAction, addMemberAction, removeMemberAction, distillLessonsAction, saveProjectLessonsAction } from "@/app/actions";
import { buildTree } from "@/app/lib/model";
import { RESULT_COLOR, riskVar, RISK_LABEL, PERSPECTIVE_LABEL, INTENSITY_LABEL } from "@/app/lib/ui";
import { PageHeader } from "@/app/lib/page-header";
import { EmptyState } from "@/app/lib/empty-state";
import { Markdown } from "@/app/lib/markdown";
import { Icon } from "@/app/lib/icons";
import { Avatar } from "@/app/lib/avatar";
import { SubmitButton } from "@/app/lib/submit-button";
import { MemberRoleSelect } from "@/app/lib/member-role-select";
import { relativeTime, isRecent } from "@/app/lib/relative-time";
import {
  currentUser,
  accessibleProjectKeys,
  filterTree,
  roleForProject,
  canEdit,
  canManageMembers,
} from "@/app/lib/access";
import type { LedgerRecord, ResultStatus } from "@/src/engine/schema";

const MEMBER_ROLE_LABEL: Record<string, string> = { owner: "owner（管理）", member: "member（作業）", viewer: "viewer（閲覧）" };
const metaLabel = "text-[11px] font-semibold uppercase tracking-[0.06em] text-muted";

export const dynamic = "force-dynamic";

interface Tally {
  total: number;
  pass: number;
  fail: number;
  blocked: number;
  none: number;
}

function tally(records: LedgerRecord[], results: Record<string, ResultStatus>): Tally {
  const t: Tally = { total: records.length, pass: 0, fail: 0, blocked: 0, none: 0 };
  for (const r of records) {
    const s = results[r.id];
    if (s === "pass") t.pass++;
    else if (s === "fail") t.fail++;
    else if (s === "blocked") t.blocked++;
    else t.none++;
  }
  return t;
}

function Bar({ t }: { t: Tally }) {
  const seg = (n: number, color: string) =>
    t.total > 0 && n > 0 ? <div style={{ width: `${(n / t.total) * 100}%`, background: color }} /> : null;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-chip">
      {seg(t.pass, RESULT_COLOR.pass)}
      {seg(t.fail, RESULT_COLOR.fail)}
      {seg(t.blocked, RESULT_COLOR.blocked)}
      {seg(t.none, "var(--border-strong)")}
    </div>
  );
}

// 合格率のリング（依存なしの SVG ドーナツ）。
function Donut({ pass, total }: { pass: number; total: number }) {
  const pct = total > 0 ? pass / total : 0;
  const radius = 34;
  const circ = 2 * Math.PI * radius;
  const dash = circ * pct;
  return (
    <div className="relative grid size-[92px] shrink-0 place-items-center">
      <svg width="92" height="92" viewBox="0 0 92 92" className="-rotate-90">
        <circle cx="46" cy="46" r={radius} fill="none" stroke="var(--chip)" strokeWidth="9" />
        <circle
          cx="46"
          cy="46"
          r={radius}
          fill="none"
          stroke="var(--ok-solid)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ - dash}`}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-[20px] font-semibold leading-none tabular-nums">
          {Math.round(pct * 100)}
          <span className="text-[12px]">%</span>
        </div>
        <div className="mt-0.5 text-[10px] text-muted">合格率</div>
      </div>
    </div>
  );
}

const LEGEND = [
  { label: "合格", color: "var(--ok-solid)", key: "pass" },
  { label: "不合格", color: "var(--bad-solid)", key: "fail" },
  { label: "ブロック", color: "var(--warn-solid)", key: "blocked" },
  { label: "未実施", color: "var(--border-strong)", key: "none" },
] as const;

function Legend({ t }: { t: Tally }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
      {LEGEND.map((l) => (
        <span key={l.key} className="flex items-center gap-1.5 text-muted">
          <span className="size-2 rounded-full" style={{ background: l.color }} />
          {l.label} <b className="tabular-nums text-ink">{t[l.key]}</b>
        </span>
      ))}
    </div>
  );
}

export default async function ProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; memberr?: string }>;
}) {
  const { p, memberr } = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login");
  const ledger = openLedger();
  try {
    const tree = filterTree(
      buildTree(ledger.listProjects(), ledger.listIssues(), ledger.listRecords({})),
      accessibleProjectKeys(ledger, user)
    );
    const project = tree.find((x) => x.id === p) ?? tree[0];
    if (!project) notFound();

    const myRole = roleForProject(ledger, user, project.key);
    const iCanEdit = canEdit(myRole);
    const iCanManage = canManageMembers(myRole);
    const members = ledger.listMembers(project.key);
    const userById = Object.fromEntries(ledger.listUsers().map((u) => [u.id, u]));

    const meta = ledger.getProject(project.key);
    const inp = "w-full field";
    const allAdopted = project.issues.flatMap((iss) => iss.records.filter((r) => r.adopted));
    const results = ledger.latestResults(allAdopted.map((r) => r.id));
    const overall = tally(allAdopted, results);

    const director = tally(allAdopted.filter((r) => r.perspective === "director"), results);
    const engineer = tally(allAdopted.filter((r) => r.perspective === "engineer"), results);

    // テスト前検出（オラクルの価値・§6.10③）。正常系/手動/取込は人の判断由来でないため除く。
    const oracle = project.issues.flatMap((iss) => iss.records).filter((r) => r.track === "oracle");
    const oracleDecided = oracle.filter((r) => r.status !== "pending").length;
    const corrected = oracle.filter((r) => r.status === "corrected").length;
    const unknown = oracle.filter((r) => r.status === "unknown").length;
    const confirmed = oracle.filter((r) => r.status === "confirmed").length;
    const correctedRate = oracleDecided ? Math.round((corrected / oracleDecided) * 100) : 0;
    const preTest = corrected + unknown;

    // 訂正の資産化（decisions/0023）: 学習ナレッジの元になる ✗訂正 の総数（全課題・訂正文あり）。
    const correctedTotal = project.issues
      .flatMap((iss) => iss.records)
      .filter((r) => r.status === "corrected" && r.declaredIntent).length;

    // テスト前検出の内訳: リスク領域別／課題別（✗訂正＋?不明）。
    const findings = oracle.filter((r) => r.status === "corrected" || r.status === "unknown");
    const byRisk = new Map<string, number>();
    for (const r of findings) byRisk.set(r.risk, (byRisk.get(r.risk) ?? 0) + 1);
    const riskRows = [...byRisk.entries()].sort((a, b) => b[1] - a[1]);
    const maxRisk = riskRows.reduce((m, [, n]) => Math.max(m, n), 1);
    const issueFindings = project.issues
      .map((iss) => {
        const o = iss.records.filter((r) => r.track === "oracle");
        return {
          id: iss.id,
          label: iss.label,
          corrected: o.filter((r) => r.status === "corrected").length,
          unknown: o.filter((r) => r.status === "unknown").length,
        };
      })
      .filter((x) => x.corrected + x.unknown > 0)
      .sort((a, b) => b.corrected + b.unknown - (a.corrected + a.unknown));

    // 見つかった問題の「中身」（✗訂正→バグ / ?不明→穴。課題ラベル付き・訂正を上に）。
    const findingItems = project.issues
      .flatMap((iss) =>
        iss.records
          .filter((r) => r.track === "oracle" && (r.status === "corrected" || r.status === "unknown"))
          .map((r) => ({ rec: r, issueLabel: iss.label }))
      )
      .sort((a, b) => (a.rec.status === "corrected" ? 0 : 1) - (b.rec.status === "corrected" ? 0 : 1));

    // レンズ別の当たり率（decisions/0024）: どの主体×強度が実際に ✗訂正/?不明 を生んだか。
    // 実データで「効くレンズ」を可視化し、既定の選び方を較正する材料にする。
    const lensAgg = new Map<string, { produced: number; decided: number; caught: number }>();
    for (const r of oracle) {
      const k = `${r.perspective}/${r.intensity}`;
      const a = lensAgg.get(k) ?? { produced: 0, decided: 0, caught: 0 };
      a.produced++;
      if (r.status !== "pending") a.decided++;
      if (r.status === "corrected" || r.status === "unknown") a.caught++;
      lensAgg.set(k, a);
    }
    const lensRows = [...lensAgg.entries()]
      .map(([k, a]) => {
        const [perspective, intensity] = k.split("/");
        return { perspective: perspective!, intensity: intensity!, ...a, rate: a.decided ? Math.round((a.caught / a.decided) * 100) : 0 };
      })
      .sort((x, y) => y.rate - x.rate || y.produced - x.produced);
    const lensMaxRate = lensRows.reduce((m, r) => Math.max(m, r.rate), 1);

    // 担当者別の進捗（未割当は最後。decisions/0019）。
    const byAssignee = new Map<string, typeof allAdopted>();
    for (const r of allAdopted) {
      const k = r.assignee ?? "";
      const arr = byAssignee.get(k) ?? [];
      arr.push(r);
      byAssignee.set(k, arr);
    }
    const assigneeRows = [...byAssignee.entries()]
      .map(([k, recs]) => ({ key: k, name: k ? userById[k]?.name ?? k : "未割当", t: tally(recs, results) }))
      .sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : a.name.localeCompare(b.name)));

    return (
      <div className="flex">
        <Sidebar tree={tree} activeProjectId={project.id} />
        <main className="h-screen flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl p-6">
            <PageHeader
              eyebrow="プロジェクト"
              titleWrap
              title={
                <span className="inline-flex flex-wrap items-center gap-2.5">
                  {project.label}
                  {meta?.repo ? (
                    <a
                      href={`https://github.com/${meta.repo}`}
                      target="_blank"
                      rel="noreferrer"
                      title={meta.repo}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel2 px-2 py-0.5 text-[11px] font-normal text-muted no-underline hover:border-accent hover:text-ink"
                    >
                      <span className="size-1.5 rounded-full bg-ok" /> 連携中
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] font-normal text-faint">
                      <span className="size-1.5 rounded-full bg-faint" /> 未連携
                    </span>
                  )}
                </span>
              }
              actions={
                <>
                  <a href={`/api/export/project/${project.id}`} className="btn-ghost no-underline">
                    <Icon name="download" size={14} /> Excel出力
                  </a>
                  {iCanEdit ? (
                    <a
                      href={`/issue/new?projectKey=${encodeURIComponent(project.key)}&p=${project.id}`}
                      className="btn-primary no-underline"
                    >
                      <Icon name="plus" size={14} /> 課題を立てる
                    </a>
                  ) : (
                    <span className="chip">閲覧のみ</span>
                  )}
                </>
              }
            />

            {/* 設定 / リポジトリ連携（状態はサマリで一目・編集は展開） */}
            {iCanEdit ? (
              <details className="group card mt-4">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <span className="text-[9px] text-faint transition-transform group-open:rotate-90">▶</span>
                  <span className={metaLabel}>設定</span>
                  {meta?.repo ? (
                    <span className="ml-1 inline-flex items-center gap-1.5 text-[12px]">
                      <span className="size-1.5 shrink-0 rounded-full bg-ok" />
                      <span className="font-mono text-ink">{meta.repo}</span>
                      <span className="rounded-full bg-ok-soft px-1.5 py-0.5 text-[10px] font-semibold text-ok">連携中</span>
                    </span>
                  ) : (
                    <span className="ml-1 inline-flex items-center gap-1.5 text-[12px] text-muted">
                      <span className="size-1.5 shrink-0 rounded-full bg-faint" />
                      リポジトリ未連携
                    </span>
                  )}
                </summary>
                <div className="border-t border-line px-4 py-3.5">
                  {meta?.repo ? (
                    <a
                      href={`https://github.com/${meta.repo}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mb-3 inline-flex items-center gap-1.5 text-[12px] text-muted no-underline hover:text-ink"
                    >
                      <Icon name="external" size={13} /> GitHub でリポジトリを開く
                    </a>
                  ) : null}
                  <form action={saveProjectAction} className="space-y-3">
                    <input type="hidden" name="key" value={project.key} />
                    <input type="hidden" name="createdAt" value={meta?.createdAt ?? ""} />
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-faint">プロジェクト名</label>
                      <input name="label" defaultValue={meta?.label ?? project.label} className={inp} />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-faint">説明</label>
                      <textarea name="description" rows={2} defaultValue={meta?.description ?? ""} className={`${inp} resize-y`} />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-faint">GitHub リポジトリ（owner/repo・URL可）</label>
                      <input name="repo" defaultValue={meta?.repo ?? ""} placeholder="owner/repo" className={inp} />
                      <p className="mt-1 text-[11px] text-faint">連携すると課題作成時に PR番号/パスだけで指定でき、private は gh 認証を自動利用します。</p>
                    </div>
                    <SubmitButton className="btn-primary" pendingText="保存中…">保存</SubmitButton>
                  </form>
                </div>
              </details>
            ) : null}

            {/* メンバー（招待制・サマリにスタックアバター） */}
            <details className="group card mt-3">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <span className="text-[9px] text-faint transition-transform group-open:rotate-90">▶</span>
                <span className={metaLabel}>メンバー</span>
                <span className="text-[12px] tabular-nums text-muted">{members.length}</span>
                <div className="ml-1 flex -space-x-1.5">
                  {members.slice(0, 6).map((m) => (
                    <span key={m.userId} className="inline-flex rounded-full ring-2 ring-panel">
                      <Avatar name={userById[m.userId]?.name ?? m.userId} size={22} />
                    </span>
                  ))}
                </div>
                {members.length > 6 ? <span className="text-[11px] text-faint">+{members.length - 6}</span> : null}
                {!iCanManage ? <span className="ml-auto text-[11px] text-faint">閲覧のみ</span> : null}
              </summary>
              <div className="space-y-3 border-t border-line px-4 py-3.5">
                {memberr === "notfound" ? (
                  <p className="rounded-md border border-bad-border bg-bad-soft px-3 py-2 text-[12px] text-bad">
                    そのメールのユーザーは未登録です。先に本人に新規登録してもらってください（招待制）。
                  </p>
                ) : null}
                <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                  {members.map((m) => {
                    const mu = userById[m.userId];
                    return (
                      <div key={m.userId} className="flex items-center gap-2.5 px-3 py-2.5 text-[13px]">
                        <Avatar name={mu?.name ?? m.userId} size={30} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-ink">{mu?.name ?? m.userId}</span>
                          <span className="block truncate text-[11px] text-muted">{mu?.email ?? ""}</span>
                        </span>
                        <span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-faint sm:flex" title="最終ログイン">
                          <span
                            className="size-1.5 rounded-full"
                            style={{ background: isRecent(mu?.lastSeenAt) ? "var(--ok)" : "var(--faint)" }}
                          />
                          {relativeTime(mu?.lastSeenAt)}
                        </span>
                        {iCanManage ? (
                          <>
                            <MemberRoleSelect projectKey={project.key} userId={m.userId} role={m.role} />
                            <form action={removeMemberAction}>
                              <input type="hidden" name="projectKey" value={project.key} />
                              <input type="hidden" name="userId" value={m.userId} />
                              <button
                                title="メンバーを削除"
                                className="grid size-7 place-items-center rounded-md text-muted hover:bg-bad-soft hover:text-bad"
                              >
                                <Icon name="x" size={14} />
                              </button>
                            </form>
                          </>
                        ) : (
                          <span className="chip">{MEMBER_ROLE_LABEL[m.role] ?? m.role}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {iCanManage ? (
                  <form action={addMemberAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="projectKey" value={project.key} />
                    <input name="email" type="email" required placeholder="登録済みユーザーのメール" className={`${inp} min-w-[200px] flex-1`} />
                    <select name="role" defaultValue="member" className="select">
                      <option value="owner">owner</option>
                      <option value="member">member</option>
                      <option value="viewer">viewer</option>
                    </select>
                    <SubmitButton className="btn-primary" pendingText="追加中…">
                      <Icon name="plus" size={14} /> 追加
                    </SubmitButton>
                    <span className="w-full text-[11px] text-faint">※招待制：先に本人に新規登録してもらい、そのメールで追加します。</span>
                  </form>
                ) : null}
              </div>
            </details>

            {/* 学習ナレッジ（訂正の資産化・decisions/0023）— ✗訂正から抽出した再利用可能な教訓 */}
            {correctedTotal > 0 || meta?.lessons ? (
              <details className="group card mt-3" open={!!meta?.lessons}>
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <span className="text-[9px] text-faint transition-transform group-open:rotate-90">▶</span>
                  <span className={metaLabel}>学習ナレッジ（訂正から）</span>
                  {meta?.lessons ? (
                    <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">あり</span>
                  ) : (
                    <span className="text-[11px] text-faint">未抽出</span>
                  )}
                  <span className="ml-auto text-[11px] text-faint">✗訂正 {correctedTotal} 件 → 観測の前提知識に注入</span>
                </summary>
                <div className="border-t border-line px-4 py-3.5">
                  <p className="mb-3 text-[12px] text-muted">
                    この課題群で積んだ <b className="text-bad">✗訂正</b> から繰り返しの教訓を抽出し、配下すべての観測/尋問の
                    <b className="text-ink">前提知識</b>に自動で注入します（使うほど質問が賢くなります）。
                  </p>
                  {iCanEdit ? (
                    <div className="mb-3 flex items-center justify-end">
                      <form action={distillLessonsAction}>
                        <input type="hidden" name="key" value={project.key} />
                        <SubmitButton
                          className="inline-flex items-center gap-1 rounded-md border border-line bg-accent-soft px-2.5 py-1 text-[12px] text-accent hover:border-accent"
                          pendingText="抽出中…"
                        >
                          <Icon name="activity" size={13} /> 訂正から教訓を抽出
                        </SubmitButton>
                      </form>
                    </div>
                  ) : null}
                  {meta?.lessons ? (
                    <div className="max-h-96 overflow-auto pr-1">
                      <Markdown text={meta.lessons} />
                    </div>
                  ) : (
                    <p className="text-[13px] text-faint">
                      未抽出。「訂正から教訓を抽出」で下書きできます（{correctedTotal} 件の訂正が対象）。
                    </p>
                  )}
                  {iCanEdit ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-[12px] text-muted hover:text-ink">手で編集</summary>
                      <form action={saveProjectLessonsAction} className="mt-2.5 space-y-2">
                        <input type="hidden" name="key" value={project.key} />
                        <textarea
                          name="lessons"
                          rows={8}
                          defaultValue={meta?.lessons ?? ""}
                          placeholder="箇条書き（マークダウン）で教訓を…"
                          className={`${inp} resize-y font-mono text-[12px]`}
                        />
                        <SubmitButton className="btn-ghost" pendingText="保存中…">保存</SubmitButton>
                      </form>
                    </details>
                  ) : null}
                </div>
              </details>
            ) : null}

            {project.issues.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  icon={<Icon name="folder" size={22} />}
                  title="まだ課題がありません"
                  description="課題（PR / ファイル / 範囲）を立てて、観測 → 候補 → テスト項目を作りはじめましょう。"
                  action={
                    iCanEdit ? (
                      <a
                        href={`/issue/new?projectKey=${encodeURIComponent(project.key)}&p=${project.id}`}
                        className="btn-primary no-underline"
                      >
                        <Icon name="plus" size={14} /> 課題を立てる
                      </a>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <>
                {/* テスト前検出（オラクルの価値・§6.10③）— このツールの存在価値の直接指標 */}
                {oracleDecided > 0 ? (
                  <div className="mt-4 card p-5">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">テスト前検出（オラクルの価値）</span>
                      <span className="text-[11px] text-faint">§6.8 テストを1行も走らせる前に見つかった欠陥・仕様の穴</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
                      <div>
                        <div className="text-[32px] font-semibold leading-none tabular-nums">{preTest}</div>
                        <div className="mt-1 text-[12px] text-muted">テスト前に見つけた問題</div>
                      </div>
                      <div className="hidden h-12 w-px bg-line sm:block" />
                      <div className="flex gap-6 text-[13px]">
                        <div>
                          <div className="text-[18px] font-semibold tabular-nums" style={{ color: "var(--bad)" }}>{corrected}</div>
                          <div className="text-[11px] text-muted">✗ 訂正（バグ）</div>
                        </div>
                        <div>
                          <div className="text-[18px] font-semibold tabular-nums" style={{ color: "var(--warn)" }}>{unknown}</div>
                          <div className="text-[11px] text-muted">? 不明（穴）</div>
                        </div>
                        <div>
                          <div className="text-[18px] font-semibold tabular-nums" style={{ color: "var(--ok)" }}>{confirmed}</div>
                          <div className="text-[11px] text-muted">✓ 意図通り</div>
                        </div>
                      </div>
                      <div className="ml-auto text-right">
                        <div className="text-[24px] font-semibold tabular-nums" style={{ color: "var(--bad)" }}>{correctedRate}%</div>
                        <div className="text-[11px] text-muted">✗訂正率（{corrected}/{oracleDecided}）</div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* テスト前検出の内訳: リスク領域別／課題別 */}
                {preTest > 0 ? (
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div className="card p-4">
                      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">リスク領域別（✗訂正・?不明）</div>
                      <div className="space-y-2">
                        {riskRows.map(([risk, n]) => (
                          <div key={risk} className="flex items-center gap-2 text-[12px]">
                            <span className="size-2 shrink-0 rounded-full" style={{ background: riskVar(risk as keyof typeof RISK_LABEL) }} />
                            <span className="w-14 shrink-0 text-muted">{RISK_LABEL[risk as keyof typeof RISK_LABEL] ?? risk}</span>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-chip">
                              <div className="h-full rounded-full" style={{ width: `${(n / maxRisk) * 100}%`, background: riskVar(risk as keyof typeof RISK_LABEL) }} />
                            </div>
                            <span className="w-6 shrink-0 text-right tabular-nums text-ink">{n}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="card p-4">
                      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">課題別のテスト前検出</div>
                      <div className="space-y-0.5">
                        {issueFindings.map((x) => (
                          <a
                            key={x.id}
                            href={`/?p=${project.id}&i=${x.id}`}
                            className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-[13px] no-underline hover:bg-hover"
                          >
                            <span className="min-w-0 flex-1 truncate text-ink" title={x.label}>{x.label}</span>
                            {x.corrected > 0 ? <span className="shrink-0 tabular-nums" style={{ color: "var(--bad)" }}>✗ {x.corrected}</span> : null}
                            {x.unknown > 0 ? <span className="shrink-0 tabular-nums" style={{ color: "var(--warn)" }}>? {x.unknown}</span> : null}
                          </a>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* 見つかった問題の「中身」（説得材料） */}
                {findingItems.length > 0 ? (
                  <details className="group card mt-3">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
                      <span className="text-[9px] text-faint transition-transform group-open:rotate-90">▶</span>
                      <span className={metaLabel}>見つかった問題の中身</span>
                      <span className="text-[11px] text-faint">観測（実際の挙動）と、人が示した正しい意図の差分</span>
                    </summary>
                    <div className="space-y-2 border-t border-line px-4 py-3.5">
                      {findingItems.map(({ rec, issueLabel }) => (
                        <a
                          key={rec.id}
                          href={`/item/${rec.id}`}
                          className="block rounded-lg border border-line p-3 no-underline transition-colors hover:border-accent hover:bg-hover"
                        >
                          <div className="mb-1.5 flex flex-wrap items-center gap-2">
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                              style={{ background: rec.status === "corrected" ? "var(--bad-solid)" : "var(--warn-solid)", color: "var(--on-color)" }}
                            >
                              {rec.status === "corrected" ? "✗ 訂正（バグ）" : "? 不明（穴）"}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[11px]">
                              <span className="size-1.5 rounded-full" style={{ background: riskVar(rec.risk) }} />
                              <span className="text-muted">{RISK_LABEL[rec.risk] ?? rec.risk}</span>
                            </span>
                            <span className="ml-auto truncate text-[11px] text-faint" title={issueLabel}>{issueLabel}</span>
                          </div>
                          <div className="text-[13px] leading-relaxed">
                            <div className="text-ink/90"><span className="text-faint">観測: </span>{rec.observation}</div>
                            {rec.status === "corrected" && rec.declaredIntent ? (
                              <div className="mt-0.5" style={{ color: "var(--bad)" }}>
                                <span className="text-faint">正しくは: </span>{rec.declaredIntent}
                              </div>
                            ) : (
                              <div className="mt-0.5 text-muted"><span className="text-faint">AI推測: </span>{rec.aiAssumption}</div>
                            )}
                          </div>
                        </a>
                      ))}
                    </div>
                  </details>
                ) : null}

                {/* サマリー: 合格率リング＋内訳＋主体別バー */}
                <div className="mt-4 card p-5">
                  <div className="flex flex-wrap items-center gap-6">
                    <Donut pass={overall.pass} total={overall.total} />
                    <div className="min-w-[240px] flex-1">
                      <div className="mb-2 flex items-center justify-between text-[13px]">
                        <span className="font-semibold">テスト項目 {overall.total}</span>
                        <span className="text-muted">合格 {overall.pass} / {overall.total}</span>
                      </div>
                      <Bar t={overall} />
                      <div className="mt-3"><Legend t={overall} /></div>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 border-t border-line pt-4 text-[12px] sm:grid-cols-2">
                    <div>
                      <div className="mb-1 text-muted">業務（ディレクター） {director.total}</div>
                      <Bar t={director} />
                    </div>
                    <div>
                      <div className="mb-1 text-muted">技術（エンジニア） {engineer.total}</div>
                      <Bar t={engineer} />
                    </div>
                  </div>
                </div>

                {/* レンズ別の当たり率（decisions/0024）— どの観点が実際に問題を捕まえたか */}
                {oracleDecided > 0 ? (
                  <>
                    <h2 className="mt-6 mb-2 flex items-center gap-2 text-[13px] font-semibold text-muted">
                      レンズ別の当たり率
                      <span className="text-[11px] font-normal text-faint">主体×強度が実際に ✗訂正/?不明 を生んだ割合（効くレンズの較正）</span>
                    </h2>
                    <div className="card overflow-hidden">
                      <div className="grid grid-cols-[1fr_64px_64px_minmax(72px,1fr)] gap-3 border-b border-line bg-panel2/60 px-3 py-2 text-[11px] uppercase tracking-wider text-muted">
                        <span>レンズ（主体 / 強度）</span>
                        <span className="text-right">生成</span>
                        <span className="text-right">当たり率</span>
                        <span>捕捉 / 判定</span>
                      </div>
                      {lensRows.map((l) => (
                        <div
                          key={`${l.perspective}/${l.intensity}`}
                          className="grid grid-cols-[1fr_64px_64px_minmax(72px,1fr)] items-center gap-3 border-b border-line/70 px-3 py-2.5 text-[13px] last:border-0"
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="chip">{PERSPECTIVE_LABEL[l.perspective as "director" | "engineer"]}</span>
                            <span className="text-muted">{INTENSITY_LABEL[l.intensity as "loose" | "medium" | "strong"]}</span>
                          </span>
                          <span className="text-right tabular-nums text-muted">{l.produced}</span>
                          <span className="text-right font-semibold tabular-nums text-ink">{l.decided ? `${l.rate}%` : "—"}</span>
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-chip">
                              <span
                                className="block h-full"
                                style={{ width: `${(l.rate / lensMaxRate) * 100}%`, background: "var(--accent)" }}
                              />
                            </span>
                            <span className="shrink-0 text-[11px] tabular-nums text-muted">{l.caught}/{l.decided}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[11px] text-faint">
                      当たり率が高いレンズ＝この対象で問題をよく捕まえる観点。観測時の主体×強度の既定選びの参考に。
                    </p>
                  </>
                ) : null}

                {overall.total > 0 ? (
                  <>
                    <h2 className="mt-6 mb-2 text-[13px] font-semibold text-muted">担当者別</h2>
                    <div className="card overflow-hidden">
                      <div className="grid grid-cols-[1fr_52px_minmax(96px,160px)_56px_56px] gap-3 border-b border-line bg-panel2/60 px-3 py-2 text-[11px] uppercase tracking-wider text-muted">
                        <span>担当</span>
                        <span className="text-right">項目</span>
                        <span>進捗</span>
                        <span className="text-right">合格</span>
                        <span className="text-right">未実施</span>
                      </div>
                      {assigneeRows.map((a) => (
                        <div
                          key={a.key || "_unassigned"}
                          className="grid grid-cols-[1fr_52px_minmax(96px,160px)_56px_56px] items-center gap-3 border-b border-line/70 px-3 py-2.5 text-[13px] last:border-0"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            {a.key ? <Avatar name={a.name} size={20} /> : null}
                            <span className={`truncate ${a.key ? "text-ink" : "text-faint"}`}>{a.name}</span>
                          </span>
                          <span className="text-right tabular-nums text-muted">{a.t.total}</span>
                          <span><Bar t={a.t} /></span>
                          <span className="text-right tabular-nums text-ok">{a.t.pass || ""}</span>
                          <span className="text-right tabular-nums text-muted">{a.t.none || ""}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}

                <h2 className="mt-6 mb-2 text-[13px] font-semibold text-muted">課題別</h2>
                <div className="card overflow-hidden">
                  <div className="grid grid-cols-[1fr_52px_minmax(96px,160px)_56px_56px] gap-3 border-b border-line bg-panel2/60 px-3 py-2 text-[11px] uppercase tracking-wider text-muted">
                    <span>課題</span>
                    <span className="text-right">項目</span>
                    <span>進捗</span>
                    <span className="text-right">合格</span>
                    <span className="text-right">未実施</span>
                  </div>
                  {project.issues.map((iss) => {
                    const a = iss.records.filter((r) => r.adopted);
                    const t = tally(a, results);
                    return (
                      <a
                        key={iss.id}
                        href={`/?p=${project.id}&i=${iss.id}`}
                        className="grid grid-cols-[1fr_52px_minmax(96px,160px)_56px_56px] items-center gap-3 border-b border-line/70 px-3 py-2.5 text-[13px] no-underline last:border-0 hover:bg-hover"
                      >
                        <span className="truncate text-ink" title={iss.label}>{iss.label}</span>
                        <span className="text-right tabular-nums text-muted">{t.total}</span>
                        <span>{t.total > 0 ? <Bar t={t} /> : <span className="text-[11px] text-faint">候補のみ</span>}</span>
                        <span className="text-right tabular-nums text-ok">{t.pass || ""}</span>
                        <span className="text-right tabular-nums text-muted">{t.none || ""}</span>
                      </a>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    );
  } finally {
    ledger.close();
  }
}
