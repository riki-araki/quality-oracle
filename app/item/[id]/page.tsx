// app/item/[id]/page.tsx — 項目の詳細画面。観測/質問/意図/テストの全体、4択承認、証跡の格納。

import { notFound, redirect } from "next/navigation";
import { openLedger } from "@/app/lib/db";
import { currentUser, roleForProject, canEdit, accessibleProjectKeys, filterTree } from "@/app/lib/access";
import { Sidebar } from "@/app/lib/sidebar";
import { buildTree, sortForReview } from "@/app/lib/model";
import { ItemKeyNav } from "@/app/lib/item-keynav";
import { PasteUpload } from "@/app/lib/paste-upload";
import { ResultQuickButtons } from "@/app/lib/result-quick";
import { SubmitButton } from "@/app/lib/submit-button";
import { CopyButton } from "@/app/lib/copy-button";
import { AssigneeSelect } from "@/app/lib/assignee-select";
import { Icon } from "@/app/lib/icons";
import {
  deleteEvidenceAction,
  adoptAction,
  addResultAction,
  deleteResultAction,
  sendRequestAction,
  saveRequestAction,
  saveExchangeEvidenceAction,
  generateRequestAction,
  setPriorityAction,
} from "@/app/actions";
import { deriveFromPath, projectId } from "@/src/engine/issues";
import { Tabs } from "@/app/lib/tabs";
import { PageHeader } from "@/app/lib/page-header";
import {
  STATUS_LABEL,
  STATUS_MARK,
  KIND_LABEL,
  PERSPECTIVE_LABEL,
  INTENSITY_LABEL,
  TRACK_LABEL,
  PRIORITY_LABEL,
  PRIORITY_COLOR,
} from "@/app/lib/ui";
import { ResultBadge } from "@/app/lib/result-badge";
import { Avatar } from "@/app/lib/avatar";
import { JsonBodyField } from "@/app/lib/json-body-field";
import { EvidenceImage } from "@/app/lib/evidence-image";
import type { LedgerRecord, Evidence, Result, HttpRequest } from "@/src/engine/schema";

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

// HTTPメソッドの色付きバッジ。
const METHOD_COLOR: Record<string, string> = {
  GET: "var(--data)",
  POST: "var(--ok-solid)",
  PUT: "var(--warn-solid)",
  PATCH: "var(--oracle)",
  DELETE: "var(--bad-solid)",
};
// JSON 文字列をトークン分割して色分け（キー=青 / 文字列=緑 / 数値=琥珀 / 真偽null=紫）。
const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
function JsonTokens({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  JSON_TOKEN.lastIndex = 0;
  while ((m = JSON_TOKEN.exec(text)) !== null) {
    if (m.index > last) out.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    if (m[1] !== undefined) {
      if (m[2] !== undefined) {
        out.push(<span key={key++} style={{ color: "var(--accent)" }}>{m[1]}</span>);
        out.push(<span key={key++}>{m[2]}</span>);
      } else {
        out.push(<span key={key++} style={{ color: "var(--ok)" }}>{m[1]}</span>);
      }
    } else if (m[3] !== undefined) {
      out.push(<span key={key++} style={{ color: "var(--oracle)" }}>{m[3]}</span>);
    } else if (m[4] !== undefined) {
      out.push(<span key={key++} style={{ color: "var(--warn)" }}>{m[4]}</span>);
    }
    last = JSON_TOKEN.lastIndex;
  }
  if (last < text.length) out.push(<span key={key++}>{text.slice(last)}</span>);
  return <>{out}</>;
}

// レスポンス（ヘッダ + 空行 + 本文）を表示。ヘッダは淡色、本文が JSON なら整形＋ハイライト。
function HttpResponseView({ text }: { text: string }) {
  const sep = text.indexOf("\n\n");
  const head = sep === -1 ? text : text.slice(0, sep);
  const body = sep === -1 ? "" : text.slice(sep + 2).trim();
  let json: string | null = null;
  if (body && (body[0] === "{" || body[0] === "[")) {
    try {
      json = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      json = null;
    }
  }
  return (
    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-input p-3 font-mono text-[12px] leading-relaxed">
      <span className="text-faint">{head}</span>
      {body ? "\n\n" : ""}
      {json ? <JsonTokens text={json} /> : <span className="text-ink/90">{body}</span>}
    </pre>
  );
}

function MethodBadge({ method }: { method: string }) {
  const m = method.toUpperCase();
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-bold"
      style={{ background: METHOD_COLOR[m] ?? "var(--neutral)", color: "var(--on-color)" }}
    >
      {m}
    </span>
  );
}

// ラベル付きの読みやすいフィールド（観測・意図など）。accent=人が承認した正解を強調。
function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={accent ? "rounded-md border-l-2 border-accent bg-accent-soft/40 py-1 pl-3" : undefined}>
      <div className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-faint">{label}</div>
      <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink/90">{value}</div>
    </div>
  );
}

function ResultsPanel({
  recordId,
  items,
  today,
  userNames,
  canEdit,
}: {
  recordId: string;
  items: Result[];
  today: string;
  userNames: Record<string, string>;
  canEdit: boolean;
}) {
  const sel = "select";
  return (
    <div className="card p-4">
      <div className="mb-3 text-[13px] font-semibold">実行結果（手動テストの記録）</div>

      {items.length > 0 ? (
        <div className="mb-3 overflow-hidden rounded-md border border-line">
          {items.map((e) => (
            <div key={e.id} className="flex items-center gap-3 border-b border-line px-3 py-2 text-[13px] last:border-0">
              <span className="w-[88px] shrink-0 text-muted">{e.executedAt}</span>
              <span className="w-[64px] shrink-0">
                <ResultBadge status={e.status} />
              </span>
              <span className="min-w-0 flex-1 truncate text-ink/90">{e.note ?? ""}</span>
              {e.createdBy && userNames[e.createdBy] ? (
                <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
                  <Avatar name={userNames[e.createdBy] ?? "?"} size={16} />
                  {userNames[e.createdBy]}
                </span>
              ) : null}
              {canEdit ? (
                <form action={deleteResultAction}>
                  <input type="hidden" name="id" value={e.id} />
                  <input type="hidden" name="recordId" value={recordId} />
                  <button className="shrink-0 text-[11px] text-bad hover:underline">削除</button>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-3 text-[13px] text-muted">まだ結果はありません（未実施）。</p>
      )}

      {canEdit ? (
        <div className="border-t border-line pt-3">
          {/* ワンクリック記録（本日付・メモなし）。素早く消化するための主動線。 */}
          <ResultQuickButtons recordId={recordId} today={today} />
          {/* メモ・日付を指定したいとき */}
          <details className="mt-2">
            <summary className="cursor-pointer text-[12px] text-muted">メモ・日付を指定して記録</summary>
            <form action={addResultAction} className="mt-2 flex flex-wrap items-center gap-2">
              <input type="hidden" name="recordId" value={recordId} />
              <select name="status" className={sel} defaultValue="pass">
                <option value="pass">合格</option>
                <option value="fail">不合格</option>
                <option value="blocked">ブロック</option>
              </select>
              <input type="date" name="executedAt" defaultValue={today} className={sel} />
              <input
                name="note"
                placeholder="メモ（任意・不具合内容など）"
                className="min-w-[160px] flex-1 field"
              />
              <SubmitButton className="btn-ghost" pendingText="記録中…">記録</SubmitButton>
            </form>
          </details>
        </div>
      ) : (
        <p className="border-t border-line pt-3 text-[12px] text-muted">閲覧のみ（結果の記録には編集権限が必要です）。</p>
      )}
    </div>
  );
}

function RequestPanel({ recordId, req, canEdit }: { recordId: string; req: HttpRequest | null; canEdit: boolean }) {
  const inp = "w-full field";
  return (
    <div className="card p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold">リクエスト（HTTPコンソール）</span>
        {canEdit ? (
          <form action={generateRequestAction}>
            <input type="hidden" name="recordId" value={recordId} />
            <SubmitButton
              className="rounded-md border border-line bg-accent-soft px-3 py-1 text-[12px] text-accent hover:border-accent"
              pendingText="生成中…"
            >
              AIで下書き
            </SubmitButton>
          </form>
        ) : null}
      </div>
      <p className="mb-3 text-[11px] text-muted">人が送信し、レスポンスを見て合否を「実行結果」に記録します（自動判定はしません）。AI下書きは確認・修正してから送信を。</p>
      <form action={sendRequestAction} className="space-y-2">
        <input type="hidden" name="recordId" value={recordId} />
        <div className="flex gap-2">
          <select name="method" defaultValue={req?.method ?? "GET"} className="w-[100px] select">
            {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input name="url" defaultValue={req?.url ?? ""} placeholder="https://… / http://localhost:3000/api/…" className={`${inp} flex-1`} />
        </div>
        <textarea name="headers" rows={2} defaultValue={req?.headers ?? ""} placeholder="ヘッダ（Key: Value を改行区切り）例: Content-Type: application/json" className={`${inp} font-mono resize-y`} />
        <JsonBodyField defaultValue={req?.body ?? ""} placeholder='{"key": "value"}' className={`${inp} font-mono resize-y`} />
        {canEdit ? (
          <div className="flex gap-2">
            <SubmitButton pendingText="送信中…">送信</SubmitButton>
            <SubmitButton formAction={saveRequestAction} className="btn-ghost" pendingText="保存中…">保存のみ</SubmitButton>
          </div>
        ) : (
          <p className="text-[12px] text-muted">閲覧のみ（送信には編集権限が必要です）。</p>
        )}
      </form>

      {req?.lastResponse != null ? (
        <div className="mt-3 border-t border-line pt-3">
          <div className="flex items-center gap-2 text-[12px]">
            <MethodBadge method={req.method} />
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ background: req.lastStatus && req.lastStatus >= 200 && req.lastStatus < 400 ? "var(--ok-solid)" : "var(--bad-solid)", color: "var(--on-color)" }}
            >
              HTTP {req.lastStatus}
            </span>
            <span className="text-muted">{req.lastMs}ms</span>
            <form action={saveExchangeEvidenceAction} className="ml-auto">
              <input type="hidden" name="recordId" value={recordId} />
              <button className="btn-ghost">この送受信を証跡に保存</button>
            </form>
          </div>
          <HttpResponseView text={req.lastResponse} />
        </div>
      ) : null}
    </div>
  );
}

function EvidencePanel({
  recordId,
  items,
  allowUpload,
  title,
}: {
  recordId: string;
  items: Evidence[];
  allowUpload: boolean;
  title: string;
}) {
  return (
    <div className="card p-4">
      <div className="mb-3 text-[13px] font-semibold">{title}</div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((e) => (
          <div key={e.id} className="overflow-hidden rounded-md border border-line bg-input">
            {e.mime.startsWith("image/") ? (
              <EvidenceImage src={`/api/evidence/${e.id}`} alt={e.filename} />
            ) : (
              <a
                href={`/api/evidence/${e.id}`}
                target="_blank"
                rel="noreferrer"
                className="flex h-32 w-full flex-col items-center justify-center gap-1.5 bg-input text-[12px] text-muted no-underline"
              >
                <Icon name="fileText" size={20} />
                {e.mime === "text/plain" ? "HTTP送受信" : e.filename}
              </a>
            )}
            <div className="flex items-center gap-2 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted" title={e.filename}>
                {e.note || e.filename}
              </span>
              <form action={deleteEvidenceAction}>
                <input type="hidden" name="id" value={e.id} />
                <input type="hidden" name="recordId" value={recordId} />
                <button className="text-[11px] text-bad hover:underline">削除</button>
              </form>
            </div>
          </div>
        ))}
        {items.length === 0 ? <p className="text-[13px] text-muted">まだありません。</p> : null}
      </div>

      {allowUpload ? <PasteUpload recordId={recordId} /> : null}
    </div>
  );
}

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect("/login");
  const ledger = openLedger();
  try {
    const r = ledger.getRecord(id);
    if (!r) notFound();
    const evidence = ledger.listEvidence(id);
    const imageEv = evidence.filter((e) => e.mime.startsWith("image/"));
    const textEv = evidence.filter((e) => !e.mime.startsWith("image/"));
    const results = ledger.listResults(id);
    const userNames: Record<string, string> = Object.fromEntries(ledger.listUsers().map((u) => [u.id, u.name]));
    const httpReq = ledger.getRequest(id);
    const today = new Date().toISOString().slice(0, 10);
    const meta = ledger.getIssue(r.issueId);
    const d = deriveFromPath(meta?.sourceRef ?? r.codeRef.path);
    const pKey = meta?.projectKey ?? d.projectKey;
    // アクセス制御（Phase2）: 所属しないプロジェクトの項目は見せない。viewer は閲覧のみ。
    const role = roleForProject(ledger, user, pKey);
    if (!role) notFound();
    const iCanEdit = canEdit(role);
    const loc = {
      projectId: projectId(pKey),
      issueId: r.issueId,
      projectLabel: ledger.getProject(pKey)?.label ?? meta?.projectLabel ?? d.projectLabel,
      issueLabel: meta?.title ?? d.label,
    };
    const t = r.generatedTest;
    const tree = filterTree(
      buildTree(ledger.listProjects(), ledger.listIssues(), ledger.listRecords({})),
      accessibleProjectKeys(ledger, user)
    );

    // 課題内の採用済みテスト項目（ダッシュボードと同じ並び）で前後ナビ。
    const issueNode = tree.flatMap((p) => p.issues).find((x) => x.id === r.issueId);
    const siblings = issueNode ? sortForReview(issueNode.records.filter((x) => x.adopted)) : [];
    const idx = siblings.findIndex((x) => x.id === r.id);
    const prevId = idx > 0 ? siblings[idx - 1]!.id : null;
    const nextId = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1]!.id : null;
    const pos = idx >= 0 ? { i: idx + 1, n: siblings.length } : null;
    const latest = r.adopted ? ledger.latestResults([r.id])[r.id] : undefined;
    const members = ledger.listMembers(pKey).map((m) => ({ id: m.userId, name: userNames[m.userId] ?? m.userId }));

    // 引き継ぎ・共有用に、テスト項目を Markdown 文字列化（コピーボタンで使う）。
    const testMd = t
      ? [
          `## ${t.title}`,
          "",
          `- **Given**: ${t.given}`,
          `- **When**: ${t.when}`,
          `- **Then**: ${t.then}`,
          "",
          `> 種別: ${KIND_LABEL[t.kind]} ／ 優先度: ${PRIORITY_LABEL[r.priority]} ／ リスク: ${r.risk} ／ 対象: ${r.anchor}`,
          ...(t.rationale ? ["", t.rationale] : []),
        ].join("\n")
      : "";

    return (
      <div className="flex">
        <Sidebar tree={tree} activeProjectId={loc.projectId} activeIssueId={loc.issueId} />
        <main className="h-screen flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl p-6">
          <ItemKeyNav prev={prevId} next={nextId} />
          <PageHeader
            breadcrumb={[
              { label: loc.projectLabel, href: `/?p=${loc.projectId}` },
              { label: loc.issueLabel, href: `/?p=${loc.projectId}&i=${loc.issueId}` },
            ]}
            title={t ? t.title : r.question}
            titleWrap
            actions={
              pos ? (
                <div className="flex items-center gap-1">
                  {prevId ? (
                    <a href={`/item/${prevId}`} className="btn-ghost no-underline" title="前の項目 (←)">←</a>
                  ) : (
                    <span className="btn-ghost pointer-events-none opacity-40">←</span>
                  )}
                  <span className="px-1.5 text-[12px] tabular-nums text-muted">{pos.i} / {pos.n}</span>
                  {nextId ? (
                    <a href={`/item/${nextId}`} className="btn-ghost no-underline" title="次の項目 (→)">→</a>
                  ) : (
                    <span className="btn-ghost pointer-events-none opacity-40">→</span>
                  )}
                </div>
              ) : undefined
            }
          />

          {/* ひと目で属性が分かるメタ帯 */}
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <Pill>{TRACK_LABEL[r.track]}</Pill>
            <Pill color={PRIORITY_COLOR[r.priority]}>優先{PRIORITY_LABEL[r.priority]}</Pill>
            <Pill>{r.risk}</Pill>
            <Pill>{r.kind}</Pill>
            <Pill>{PERSPECTIVE_LABEL[r.perspective]}</Pill>
            <Pill>{INTENSITY_LABEL[r.intensity]}</Pill>
            {r.confidence === "low" ? <Pill color="var(--warn-solid)">⚠ 要確認</Pill> : null}
            <span className="ml-auto truncate pl-2 font-mono text-[11px] text-faint">{r.anchor}</span>
          </div>

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            {/* メイン */}
            <div className="min-w-0 space-y-5">
              {t ? (
                <section className="card p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">テスト内容</span>
                    <Pill color={t.kind === "known_bug" ? "var(--bad-solid)" : undefined}>{KIND_LABEL[t.kind]}</Pill>
                    <CopyButton text={testMd} className="ml-auto rounded-md border border-line px-2 py-0.5 text-[11px] text-muted hover:border-accent hover:text-ink">
                      Markdownでコピー
                    </CopyButton>
                  </div>
                  <h2 className="mb-4 text-[15px] font-semibold leading-snug text-ink">{t.title}</h2>
                  <div className="space-y-2.5">
                    {([["Given", t.given], ["When", t.when], ["Then", t.then]] as const).map(([k, v]) => (
                      <div key={k} className="flex gap-3">
                        <span className="mt-px w-14 shrink-0 rounded-md bg-panel2 py-0.5 text-center text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</span>
                        <span className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink/90">{v}</span>
                      </div>
                    ))}
                  </div>
                  {t.rationale ? <p className="mt-4 border-t border-line pt-3 text-[12px] leading-relaxed text-muted">{t.rationale}</p> : null}
                </section>
              ) : (
                <section className="card p-5">
                  <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">候補（未採用）</span>
                  <p className="mt-2 text-[13px] leading-relaxed text-muted">「採用 / 修正して採用」を選ぶとテスト項目になります（採否は項目作成画面で）。</p>
                  {iCanEdit ? (
                    <a href={`/add?i=${loc.issueId}&p=${loc.projectId}`} className="btn-primary mt-3 no-underline">項目作成画面で採否を決める</a>
                  ) : null}
                </section>
              )}

              {/* 観測と意図（なぜこの項目か）。採用済みは折りたたみ、候補は開く。 */}
              <details className="card" open={!r.adopted}>
                <summary className="cursor-pointer px-5 py-3 text-[12px] font-semibold uppercase tracking-wide text-muted">観測と意図（AIの観測・人の承認）</summary>
                <div className="space-y-3 px-5 pb-4">
                  <Field label="質問" value={r.question} />
                  <Field label="観測（AIが見た挙動）" value={r.observation} />
                  <Field label="AI推測" value={r.aiAssumption} />
                  {r.declaredIntent ? <Field label="宣言した意図（承認された正解）" value={r.declaredIntent} accent /> : null}
                </div>
              </details>

              {r.adopted ? (
                <>
                  <ResultsPanel recordId={r.id} items={results} today={today} userNames={userNames} canEdit={iCanEdit} />
                  <Tabs
                    tabs={[
                      {
                        label: "リクエスト（API）",
                        content: (
                          <div className="space-y-3">
                            <RequestPanel recordId={r.id} req={httpReq} canEdit={iCanEdit} />
                            {textEv.length > 0 ? (
                              <EvidencePanel recordId={r.id} items={textEv} allowUpload={false} title="保存した送受信" />
                            ) : null}
                          </div>
                        ),
                      },
                      {
                        label: "画面化（UI）",
                        content: (
                          <EvidencePanel recordId={r.id} items={imageEv} allowUpload={iCanEdit} title="証跡（スクリーンショット）" />
                        ),
                      },
                    ]}
                  />
                </>
              ) : (
                <EvidencePanel recordId={r.id} items={evidence} allowUpload={iCanEdit} title="証跡" />
              )}
            </div>

            {/* 操作（右レール・スクロール追従） */}
            <aside className="lg:sticky lg:top-6">
              <div className="card divide-y divide-line text-[13px]">
                {r.adopted ? (
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-muted">最新結果</span>
                    {latest ? (
                      <ResultBadge status={latest} />
                    ) : (
                      <span className="text-[12px] text-faint">未実施</span>
                    )}
                  </div>
                ) : null}
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-muted">状態</span>
                  <span className="font-medium text-ink">{STATUS_MARK[r.status]} {STATUS_LABEL[r.status]}</span>
                </div>
                <div className="flex items-center justify-between gap-2 px-4 py-3">
                  <span className="text-muted">採用</span>
                  <span className="flex items-center gap-2">
                    {r.adopted ? (
                      <>
                        <Pill color="var(--ok-solid)">採用済み</Pill>
                        {iCanEdit ? (
                          <form action={adoptAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="adopt" value="false" />
                            <button className="text-[12px] text-muted hover:underline">解除</button>
                          </form>
                        ) : null}
                      </>
                    ) : (
                      <Pill>候補</Pill>
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 px-4 py-3">
                  <span className="text-muted">担当者</span>
                  {iCanEdit ? (
                    <AssigneeSelect recordId={r.id} value={r.assignee} members={members} />
                  ) : (
                    <span className="text-ink">{r.assignee ? userNames[r.assignee] ?? r.assignee : "未割当"}</span>
                  )}
                </div>
                {iCanEdit ? (
                  <div className="flex items-center justify-between gap-2 px-4 py-3">
                    <span className="text-muted">優先度</span>
                    <form action={setPriorityAction} className="flex items-center gap-1">
                      <input type="hidden" name="recordId" value={r.id} />
                      {(["high", "medium", "low"] as const).map((pv) => (
                        <button
                          key={pv}
                          name="priority"
                          value={pv}
                          className="rounded-md border px-2 py-0.5 text-[12px]"
                          style={
                            r.priority === pv
                              ? { background: PRIORITY_COLOR[pv], color: "var(--on-color)", borderColor: PRIORITY_COLOR[pv] }
                              : { borderColor: "var(--border-strong)", color: "var(--faint)" }
                          }
                        >
                          {PRIORITY_LABEL[pv]}
                        </button>
                      ))}
                    </form>
                  </div>
                ) : (
                  <div className="px-4 py-3"><Pill color="var(--neutral)">閲覧のみ</Pill></div>
                )}
              </div>
            </aside>
          </div>
          </div>
        </main>
      </div>
    );
  } finally {
    ledger.close();
  }
}
