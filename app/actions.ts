"use server";
// app/actions.ts — 承認（§6.7）と証跡（decisions/0006）の Server Action。

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { openLedger } from "@/app/lib/db";
import { saveEvidence, removeEvidence, saveTextEvidence } from "@/app/lib/evidence";
import { sendHttp } from "@/app/lib/http";
import { runObservation, runNormal, runDriftCheck, getClient, getModel, resolveCode, githubToken, saveUsages } from "@/app/lib/observe";
import { generateTest, analyzeKnowledge, generateRequest, distillLessons } from "@/src/engine/pipeline";
import type { Usage, Correction } from "@/src/engine/pipeline";
import type { AiUsageKind } from "@/src/engine/schema";
import { deriveFromPath, issueId, projectId, hashKey } from "@/src/engine/issues";
import { recordId } from "@/src/engine/ids";
import { ApprovalStatus, Perspective, Intensity, Priority, ResultStatus, ImportItem, MemberRole, priorityFromRisk } from "@/src/engine/schema";
import type { Issue, LedgerRecord } from "@/src/engine/schema";
import {
  currentUser,
  projectKeyForRecord,
  projectKeyForIssue,
  roleForProject,
  canEdit,
  canManageMembers,
} from "@/app/lib/access";
import type { SqliteLedger } from "@/src/engine/ledger";

type Identity = Omit<Issue, "knowledge">;

// ── アクセス制御（Phase2・decisions/0018）────────────────────────────────────
// 編集権限の確認。viewer/未所属/未ログインは例外を投げる。
async function assertCanEditProject(ledger: SqliteLedger, projectKey: string | null): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("ログインが必要です。");
  if (!projectKey) throw new Error("対象プロジェクトを特定できません。");
  if (!canEdit(roleForProject(ledger, user, projectKey))) {
    throw new Error("このプロジェクトを編集する権限がありません（閲覧のみ）。");
  }
}
async function assertCanEditRecord(ledger: SqliteLedger, recId: string): Promise<void> {
  await assertCanEditProject(ledger, projectKeyForRecord(ledger, recId));
}
async function assertCanEditIssue(ledger: SqliteLedger, iid: string): Promise<void> {
  await assertCanEditProject(ledger, projectKeyForIssue(ledger, iid));
}

function readIdentity(fd: FormData): Identity {
  return {
    id: String(fd.get("id") ?? ""),
    projectKey: String(fd.get("projectKey") ?? ""),
    projectLabel: String(fd.get("projectLabel") ?? ""),
    title: String(fd.get("title") ?? "").trim() || "（無題）",
    overview: (() => {
      const v = fd.get("overview");
      return typeof v === "string" && v.trim() ? v : null;
    })(),
    sourceKind: String(fd.get("sourceKind") ?? "none") as Identity["sourceKind"],
    sourceRef: (() => {
      const v = fd.get("sourceRef");
      return typeof v === "string" && v.trim() ? v : null;
    })(),
    createdAt: String(fd.get("createdAt") ?? "") || new Date().toISOString(),
  };
}

function revalidateItem(recordId: string): void {
  revalidatePath("/");
  revalidatePath(`/item/${recordId}`);
}

export async function decideAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const status = ApprovalStatus.parse(String(formData.get("status") ?? ""));
  const intentRaw = formData.get("intent");
  const intent = typeof intentRaw === "string" && intentRaw.trim() ? intentRaw : null;

  const ledger = openLedger();
  try {
    await assertCanEditRecord(ledger, id);
    ledger.setDecision(id, status, intent);
  } finally {
    ledger.close();
  }
  revalidateItem(id);
}

export async function uploadEvidenceAction(formData: FormData): Promise<void> {
  const recordId = String(formData.get("recordId") ?? "");
  const file = formData.get("file");
  const noteRaw = formData.get("note");
  const note = typeof noteRaw === "string" ? noteRaw : null;
  if (!recordId) throw new Error("recordId がありません。");
  if (!(file instanceof File) || file.size === 0) throw new Error("画像ファイルを選んでください。");

  const lg = openLedger();
  try {
    await assertCanEditRecord(lg, recordId);
  } finally {
    lg.close();
  }
  await saveEvidence(recordId, file, note);
  revalidateItem(recordId);
}

// 試験の優先度を変更（高/中/低。decisions/0017）。
export async function setPriorityAction(formData: FormData): Promise<void> {
  const recordId = String(formData.get("recordId") ?? "");
  const priority = Priority.parse(String(formData.get("priority") ?? ""));
  if (!recordId) throw new Error("recordId がありません。");
  const ledger = openLedger();
  try {
    await assertCanEditRecord(ledger, recordId);
    ledger.setPriority(recordId, priority);
  } finally {
    ledger.close();
  }
  revalidateItem(recordId);
}

// 担当者を割り当て/解除（プロジェクトメンバーのみ。decisions/0019）。
export async function setAssigneeAction(formData: FormData): Promise<void> {
  const recordId = String(formData.get("recordId") ?? "");
  const raw = String(formData.get("assignee") ?? "").trim();
  const assignee = raw || null;
  if (!recordId) throw new Error("recordId がありません。");
  const ledger = openLedger();
  try {
    await assertCanEditRecord(ledger, recordId);
    // 割り当て先はプロジェクトメンバーに限定（未割当=null は許可）。
    if (assignee) {
      const pk = projectKeyForRecord(ledger, recordId);
      const ok = pk && ledger.listMembers(pk).some((m) => m.userId === assignee);
      if (!ok) throw new Error("担当者はプロジェクトのメンバーから選んでください。");
    }
    ledger.setAssignee(recordId, assignee);
  } finally {
    ledger.close();
  }
  revalidateItem(recordId);
  revalidatePath("/");
}

export async function deleteEvidenceAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const recordId = String(formData.get("recordId") ?? "");
  if (!id) throw new Error("id がありません。");
  if (recordId) {
    const lg = openLedger();
    try {
      await assertCanEditRecord(lg, recordId);
    } finally {
      lg.close();
    }
  }
  removeEvidence(id);
  revalidateItem(recordId);
}

// ＋項目追加（別画面）: 課題の対象を選んだレンズで再観測し、候補を追加する（decisions/0008）。
export async function observeAction(formData: FormData): Promise<void> {
  const targetRaw = formData.get("target");
  const target = typeof targetRaw === "string" && targetRaw !== "" ? targetRaw : null;
  const lens = {
    perspective: Perspective.parse(String(formData.get("perspective") ?? "engineer")),
    intensity: Intensity.parse(String(formData.get("intensity") ?? "strong")),
  };
  const iid = String(formData.get("issueId") ?? "") || undefined;
  const regression = formData.get("regression") === "on";
  const user = await currentUser();
  if (iid) {
    const lg = openLedger();
    try {
      await assertCanEditIssue(lg, iid);
    } finally {
      lg.close();
    }
  }
  await runObservation(target, lens, iid, regression, user?.id ?? null);
  revalidatePath("/add");
  revalidatePath("/");
}

// ── プロジェクト（一級エンティティ・decisions/0012, 0013）──────────────────────
function normalizeRepo(raw: unknown): string | null {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  const m = s.match(/^([^/\s]+\/[^/\s]+)/);
  return m ? m[1]! : null;
}

export async function createProjectAction(formData: FormData): Promise<void> {
  const label = String(formData.get("label") ?? "").trim();
  if (!label) throw new Error("プロジェクト名を入力してください。");
  const descRaw = formData.get("description");
  const description = typeof descRaw === "string" && descRaw.trim() ? descRaw : null;
  const repo = normalizeRepo(formData.get("repo"));
  const key = `p_${hashKey(label)}`;
  const user = await currentUser();
  if (!user) throw new Error("ログインが必要です。");
  const ledger = openLedger();
  try {
    ledger.upsertProject({ key, label, description, repo, createdAt: new Date().toISOString() });
    // 作成者を owner として登録（以後このプロジェクトは作成者の所有・decisions/0018 Phase2）。
    ledger.addMember(key, user.id, "owner");
  } finally {
    ledger.close();
  }
  revalidatePath("/");
  redirect(`/project?p=${projectId(key)}`);
}

// プロジェクトの編集（名前/説明/リポジトリ連携）。
export async function saveProjectAction(formData: FormData): Promise<void> {
  const key = String(formData.get("key") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  if (!key || !label) throw new Error("プロジェクト名が必要です。");
  const descRaw = formData.get("description");
  const description = typeof descRaw === "string" && descRaw.trim() ? descRaw : null;
  const repo = normalizeRepo(formData.get("repo"));
  const createdAt = String(formData.get("createdAt") ?? "") || new Date().toISOString();
  const ledger = openLedger();
  try {
    await assertCanEditProject(ledger, key);
    ledger.upsertProject({ key, label, description, repo, createdAt });
  } finally {
    ledger.close();
  }
  revalidatePath("/");
}

// ── 学習ナレッジ（訂正の資産化・decisions/0023）──────────────────────────────
// プロジェクト配下の ✗訂正 履歴から教訓を抽出し、プロジェクトの学習ナレッジに保存する。
// これは配下すべての観測の <前提知識> に注入され「使うほど質問が賢くなる」土台になる。
export async function distillLessonsAction(formData: FormData): Promise<void> {
  const key = String(formData.get("key") ?? "");
  if (!key) throw new Error("プロジェクトキーがありません。");
  const user = await currentUser();
  const lg0 = openLedger();
  try {
    await assertCanEditProject(lg0, key);
  } finally {
    lg0.close();
  }

  // 訂正履歴を集める（配下の全課題・status=corrected・人の訂正文あり）。
  const gather = openLedger();
  const corrections: Correction[] = [];
  try {
    const issueIds = gather.listIssues().filter((i) => i.projectKey === key).map((i) => i.id);
    for (const iid of issueIds) {
      for (const r of gather.listRecords({ issueId: iid, status: "corrected" })) {
        if (r.declaredIntent) {
          corrections.push({ anchor: r.anchor, observation: r.observation, correctedIntent: r.declaredIntent });
        }
      }
    }
  } finally {
    gather.close();
  }
  if (corrections.length === 0) {
    throw new Error("まだ ✗訂正 がありません。訂正が貯まると、そこから教訓を抽出できます。");
  }

  const usages: { kind: AiUsageKind; u: Usage }[] = [];
  const lessons = await distillLessons(getClient(), getModel(), corrections, (u) => usages.push({ kind: "lessons", u }));
  const ledger = openLedger();
  try {
    ledger.setProjectLessons(key, lessons || null);
    saveUsages(ledger, usages, { userId: user?.id ?? null, projectKey: key, issueId: null });
  } finally {
    ledger.close();
  }
  revalidatePath("/project");
  revalidatePath("/");
}

// 学習ナレッジを手で編集して保存。
export async function saveProjectLessonsAction(formData: FormData): Promise<void> {
  const key = String(formData.get("key") ?? "");
  if (!key) throw new Error("プロジェクトキーがありません。");
  const raw = formData.get("lessons");
  const lessons = typeof raw === "string" && raw.trim() ? raw : null;
  const ledger = openLedger();
  try {
    await assertCanEditProject(ledger, key);
    ledger.setProjectLessons(key, lessons);
  } finally {
    ledger.close();
  }
  revalidatePath("/project");
}

// ── 課題（一級エンティティ・decisions/0010）─────────────────────────────────
// 選んだプロジェクトに、ソース（PR/ファイル/ローカル）の課題を立てる。projectKey は選択値。
export async function createIssueAction(formData: FormData): Promise<void> {
  const title = String(formData.get("title") ?? "").trim() || "（無題）";
  const overviewRaw = formData.get("overview");
  const overview = typeof overviewRaw === "string" && overviewRaw.trim() ? overviewRaw : null;
  const sourceKind = String(formData.get("sourceKind") ?? "none");
  const sourceRaw = String(formData.get("sourceRef") ?? "").trim();
  const projectKey = String(formData.get("projectKey") ?? "").trim() || "manual";

  const ledger = openLedger();
  let projectLabel = projectKey;
  try {
    await assertCanEditProject(ledger, projectKey);
    const project = ledger.getProject(projectKey);
    const repo = project?.repo ?? null;

    let issueKey: string;
    let sourceRef: string | null;
    if (sourceKind === "pr") {
      // 連携リポジトリがあれば PR番号だけでOK。無ければ owner/repo#123。
      const m = sourceRaw.match(/^#?(\d+)$/);
      const ref = m && repo ? `${repo}#${m[1]}` : sourceRaw;
      if (!/^[^/\s]+\/[^#\s]+#\d+$/.test(ref))
        throw new Error("PRは「owner/repo#123」、リポジトリ連携済みなら番号だけで指定してください。");
      sourceRef = `gh:${ref}`;
      issueKey = deriveFromPath(sourceRef).issueKey;
    } else if (sourceKind === "file") {
      const ref = repo && !sourceRaw.includes(":") ? `${repo}:${sourceRaw}` : sourceRaw;
      sourceRef = `gh:${ref}`;
      if (deriveFromPath(sourceRef).sourceKind !== "file")
        throw new Error("ファイルは「owner/repo:path」、リポジトリ連携済みならパスだけで指定してください。");
      issueKey = deriveFromPath(sourceRef).issueKey;
    } else if (sourceKind === "local") {
      if (!sourceRaw) throw new Error("ローカルパスを入力してください。");
      sourceRef = sourceRaw;
      issueKey = deriveFromPath(sourceRef).issueKey;
    } else {
      sourceRef = null;
      issueKey = `manual:${hashKey(title + new Date().toISOString())}`;
    }

    projectLabel = project?.label ?? deriveFromPath(sourceRef).projectLabel ?? projectKey;
    const id = issueId(projectKey, issueKey);
    ledger.upsertIssue({
      id,
      projectKey,
      projectLabel,
      title,
      overview,
      sourceKind: sourceKind as Identity["sourceKind"],
      sourceRef,
      createdAt: new Date().toISOString(),
    });
    revalidatePath("/");
    redirect(`/?p=${projectId(projectKey)}&i=${id}`);
  } finally {
    ledger.close();
  }
}

// 課題のタイトル/概要を保存。
export async function saveIssueAction(formData: FormData): Promise<void> {
  const idn = readIdentity(formData);
  const ledger = openLedger();
  try {
    await assertCanEditProject(ledger, idn.projectKey);
    ledger.upsertIssue(idn);
  } finally {
    ledger.close();
  }
  revalidatePath("/");
}

// AI分析ナレッジを手動編集して保存。
export async function saveKnowledgeAction(formData: FormData): Promise<void> {
  const idn = readIdentity(formData);
  const knowledgeRaw = formData.get("knowledge");
  const knowledge = typeof knowledgeRaw === "string" && knowledgeRaw.trim() ? knowledgeRaw : null;
  const ledger = openLedger();
  try {
    await assertCanEditProject(ledger, idn.projectKey);
    ledger.upsertIssue(idn);
    ledger.setIssueKnowledge(idn.id, knowledge);
  } finally {
    ledger.close();
  }
  revalidatePath("/");
}

// AI分析: 概要＋ソースからナレッジを下書きして保存（人が後で編集）。
export async function analyzeKnowledgeAction(formData: FormData): Promise<void> {
  const idn = readIdentity(formData);
  let source = "（ソースなし）";
  if (idn.sourceRef) {
    try {
      source = (await resolveCode(idn.sourceRef, githubToken())).code;
    } catch (e) {
      source = `（ソース取得に失敗: ${e instanceof Error ? e.message : String(e)}）`;
    }
  }
  const user = await currentUser();
  const usages: { kind: AiUsageKind; u: Usage }[] = [];
  const draft = await analyzeKnowledge(getClient(), getModel(), idn.overview ?? "", source, (u) =>
    usages.push({ kind: "knowledge", u })
  );
  const ledger = openLedger();
  try {
    await assertCanEditProject(ledger, idn.projectKey);
    ledger.upsertIssue(idn);
    ledger.setIssueKnowledge(idn.id, draft);
    saveUsages(ledger, usages, { userId: user?.id ?? null, projectKey: idn.projectKey, issueId: idn.id });
  } finally {
    ledger.close();
  }
  revalidatePath("/");
}

// ── HTTPコンソール（手動・人が送り人が判定。decisions/0014）──────────────────
function readReq(fd: FormData) {
  return {
    recordId: String(fd.get("recordId") ?? ""),
    method: String(fd.get("method") ?? "GET"),
    url: String(fd.get("url") ?? "").trim(),
    headers: (() => {
      const v = fd.get("headers");
      return typeof v === "string" && v.trim() ? v : null;
    })(),
    body: (() => {
      const v = fd.get("body");
      return typeof v === "string" && v.trim() ? v : null;
    })(),
  };
}

export async function saveRequestAction(formData: FormData): Promise<void> {
  const r = readReq(formData);
  if (!r.recordId) throw new Error("recordId がありません。");
  const ledger = openLedger();
  try {
    await assertCanEditRecord(ledger, r.recordId);
    ledger.saveRequest(r.recordId, r);
  } finally {
    ledger.close();
  }
  revalidateItem(r.recordId);
}

export async function sendRequestAction(formData: FormData): Promise<void> {
  const r = readReq(formData);
  if (!r.recordId || !r.url) throw new Error("URL を入力してください。");
  const ledger0 = openLedger();
  try {
    await assertCanEditRecord(ledger0, r.recordId);
  } finally {
    ledger0.close();
  }
  const res = await sendHttp(r);
  const ledger = openLedger();
  try {
    ledger.saveRequest(r.recordId, r);
    ledger.setRequestResponse(r.recordId, res.status, res.ms, res.response);
  } finally {
    ledger.close();
  }
  revalidateItem(r.recordId);
}

// AIでリクエストを下書き（人が確認・修正して送信）。decisions/0015。
export async function generateRequestAction(formData: FormData): Promise<void> {
  const recordId = String(formData.get("recordId") ?? "");
  if (!recordId) throw new Error("recordId がありません。");
  const user = await currentUser();
  const ledger = openLedger();
  try {
    await assertCanEditRecord(ledger, recordId);
    const rec = ledger.getRecord(recordId);
    if (!rec) throw new Error("レコードが見つからない。");
    const knowledge = ledger.getIssue(rec.issueId)?.knowledge ?? null;
    const usages: { kind: AiUsageKind; u: Usage }[] = [];
    const draft = await generateRequest(getClient(), getModel(), rec, knowledge, (u) =>
      usages.push({ kind: "request", u })
    );
    ledger.saveRequest(recordId, {
      method: draft.method,
      url: draft.url,
      headers: draft.headers || null,
      body: draft.body || null,
    });
    saveUsages(ledger, usages, {
      userId: user?.id ?? null,
      projectKey: projectKeyForRecord(ledger, recordId),
      issueId: rec.issueId,
    });
  } finally {
    ledger.close();
  }
  revalidateItem(recordId);
}

export async function saveExchangeEvidenceAction(formData: FormData): Promise<void> {
  const recordId = String(formData.get("recordId") ?? "");
  if (!recordId) throw new Error("recordId がありません。");
  const ledger = openLedger();
  let text = "";
  try {
    await assertCanEditRecord(ledger, recordId);
    const req = ledger.getRequest(recordId);
    if (!req || req.lastResponse == null) throw new Error("先に送信してください。");
    text =
      `# Request\n${req.method} ${req.url}\n${req.headers ?? ""}\n\n${req.body ?? ""}\n\n` +
      `# Response (HTTP ${req.lastStatus}, ${req.lastMs}ms)\n${req.lastResponse}`;
  } finally {
    ledger.close();
  }
  saveTextEvidence(recordId, "exchange.txt", text, "HTTP送受信");
  revalidateItem(recordId);
}

// ── 一括操作（一覧で複数選択 → まとめて適用。権限のない項目はスキップ）──────────
export async function bulkRecordResultAction(ids: string[], status: string): Promise<void> {
  const st = ResultStatus.parse(status);
  const user = await currentUser();
  if (!user) throw new Error("ログインが必要です。");
  const createdAt = new Date().toISOString();
  const executedAt = createdAt.slice(0, 10);
  const ledger = openLedger();
  try {
    for (const recId of ids) {
      const pk = projectKeyForRecord(ledger, recId);
      if (!pk || !canEdit(roleForProject(ledger, user, pk))) continue;
      const id = createHash("sha1").update(recId).update(createdAt).update(st).digest("hex").slice(0, 16);
      ledger.addResult({ id, recordId: recId, status: st, note: null, executedAt, createdAt, createdBy: user.id });
    }
  } finally {
    ledger.close();
  }
  revalidatePath("/");
}

export async function bulkAssignAction(ids: string[], assignee: string | null): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("ログインが必要です。");
  const target = assignee || null;
  const ledger = openLedger();
  try {
    for (const recId of ids) {
      const pk = projectKeyForRecord(ledger, recId);
      if (!pk || !canEdit(roleForProject(ledger, user, pk))) continue;
      if (target && !ledger.listMembers(pk).some((m) => m.userId === target)) continue;
      ledger.setAssignee(recId, target);
    }
  } finally {
    ledger.close();
  }
  revalidatePath("/");
}

// テスト項目の実行結果を記録（手動・decisions/0009）。
export async function addResultAction(formData: FormData): Promise<void> {
  const recordId = String(formData.get("recordId") ?? "");
  const status = ResultStatus.parse(String(formData.get("status") ?? ""));
  const noteRaw = formData.get("note");
  const note = typeof noteRaw === "string" && noteRaw.trim() ? noteRaw : null;
  const dateRaw = formData.get("executedAt");
  const createdAt = new Date().toISOString();
  const executedAt = typeof dateRaw === "string" && dateRaw.trim() ? dateRaw : createdAt.slice(0, 10);
  if (!recordId) throw new Error("recordId がありません。");

  const createdBy = (await auth())?.user?.id ?? null;
  const id = createHash("sha1").update(recordId).update(createdAt).digest("hex").slice(0, 16);
  const ledger = openLedger();
  try {
    await assertCanEditRecord(ledger, recordId);
    ledger.addResult({ id, recordId, status, note, executedAt, createdAt, createdBy });
  } finally {
    ledger.close();
  }
  revalidateItem(recordId);
}

export async function deleteResultAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const recordId = String(formData.get("recordId") ?? "");
  if (!id) throw new Error("id がありません。");
  const ledger = openLedger();
  try {
    if (recordId) await assertCanEditRecord(ledger, recordId);
    ledger.deleteResult(id);
  } finally {
    ledger.close();
  }
  revalidateItem(recordId);
}

// 候補の採否（項目作成の中核）。意図通り→採用 / 違う→修正して採用 / 不採用→捨てる。
export async function curateAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!id) throw new Error("id がありません。");
  const user = await currentUser();

  const ledger = openLedger();
  try {
    await assertCanEditRecord(ledger, id);
    if (decision === "discard") {
      ledger.deleteRecord(id);
    } else if (decision === "adopt" || decision === "adopt_corrected") {
      let rec = ledger.getRecord(id);
      if (!rec) throw new Error("レコードが見つからない。");
      if (decision === "adopt_corrected") {
        const intent = String(formData.get("intent") ?? "").trim();
        if (!intent) throw new Error("修正して採用には「正しい意図」を入力してください。");
        rec = ledger.setDecision(id, "corrected", intent); // declaredIntent=訂正 → known_bug（テストはクリア）
      } else if (rec.status !== "confirmed" && rec.status !== "corrected") {
        rec = ledger.setDecision(id, "confirmed"); // 未決のオラクル → 現状を正解に
      }
      // テスト未生成なら生成（正常系は既に生成済みなのでそのまま採用）。
      if (!rec.generatedTest) {
        const usages: { kind: AiUsageKind; u: Usage }[] = [];
        const test = await generateTest(getClient(), getModel(), rec, (u) => usages.push({ kind: "testgen", u }));
        ledger.setGeneratedTest(id, test);
        saveUsages(ledger, usages, {
          userId: user?.id ?? null,
          projectKey: projectKeyForRecord(ledger, id),
          issueId: rec.issueId,
        });
      }
      ledger.setAdopted(id, true);
    } else {
      throw new Error(`未知の decision: ${decision}`);
    }
  } finally {
    ledger.close();
  }
  revalidatePath("/add");
  revalidatePath("/");
}

// ── 正常系 / 手動 / インポート（種別trackで判別。decisions/0016）─────────────────
// 正常系を生成（観測→回帰テスト項目の候補）。
export async function observeNormalAction(formData: FormData): Promise<void> {
  const targetRaw = formData.get("target");
  const target = typeof targetRaw === "string" && targetRaw !== "" ? targetRaw : null;
  const lens = {
    perspective: Perspective.parse(String(formData.get("perspective") ?? "engineer")),
    intensity: Intensity.parse(String(formData.get("intensity") ?? "strong")),
  };
  const iid = String(formData.get("issueId") ?? "") || undefined;
  if (iid) {
    const lg = openLedger();
    try {
      await assertCanEditIssue(lg, iid);
    } finally {
      lg.close();
    }
  }
  const user = await currentUser();
  await runNormal(target, lens, iid, user?.id ?? null);
  revalidatePath("/add");
  revalidatePath("/");
}

// ── 意図ドリフト検査（承認済み意図 vs 現在のコード。§6.2⑥・decisions/0022）──────────
// 課題の現在コードを再観測し、承認済みの意図と矛盾する新挙動を検出して台帳に残す。
export async function driftCheckAction(formData: FormData): Promise<void> {
  const issueIdArg = String(formData.get("issueId") ?? "");
  if (!issueIdArg) throw new Error("issueId がありません。");
  const targetRaw = formData.get("target");
  const target = typeof targetRaw === "string" && targetRaw !== "" ? targetRaw : null;
  const user = await currentUser();
  const lg = openLedger();
  try {
    await assertCanEditIssue(lg, issueIdArg);
  } finally {
    lg.close();
  }
  await runDriftCheck(target, issueIdArg, user?.id ?? null);
  revalidatePath("/");
}

// ドリフト検出の対応: update=新挙動を正として意図を更新（テスト再生成）/ dismiss=無視。
export async function resolveDriftAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!id) throw new Error("id がありません。");
  const user = await currentUser();
  const ledger = openLedger();
  try {
    const issueIdArg = ledger.getDriftIssueId(id);
    if (!issueIdArg) throw new Error("検出が見つからない。");
    await assertCanEditIssue(ledger, issueIdArg);
    if (decision === "dismiss") {
      ledger.setDriftStatus(id, "dismissed");
    } else if (decision === "update") {
      const finding = ledger.listDriftFindings(issueIdArg).find((f) => f.id === id);
      if (!finding) throw new Error("検出が見つからない。");
      // 新挙動を「正しい意図」として承認し直し、回帰テストを作り直す。
      const rec = ledger.updateIntent(finding.specRecordId, finding.newObservation);
      const usages: { kind: AiUsageKind; u: Usage }[] = [];
      const test = await generateTest(getClient(), getModel(), rec, (u) => usages.push({ kind: "testgen", u }));
      ledger.setGeneratedTest(rec.id, test);
      ledger.setDriftStatus(id, "resolved");
      saveUsages(ledger, usages, {
        userId: user?.id ?? null,
        projectKey: projectKeyForIssue(ledger, issueIdArg),
        issueId: issueIdArg,
      });
    } else {
      throw new Error(`未知の decision: ${decision}`);
    }
  } finally {
    ledger.close();
  }
  revalidatePath("/");
}

// 正常系の候補を一括採用（既に回帰テスト生成済みなので採用フラグだけ）。
export async function adoptAllNormalAction(formData: FormData): Promise<void> {
  const issueIdArg = String(formData.get("issueId") ?? "");
  if (!issueIdArg) throw new Error("issueId がありません。");
  const ledger = openLedger();
  try {
    await assertCanEditIssue(ledger, issueIdArg);
    for (const r of ledger.listRecords({ adopted: false })) {
      if (r.issueId === issueIdArg && r.track === "normal") ledger.setAdopted(r.id, true);
    }
  } finally {
    ledger.close();
  }
  revalidatePath("/add");
  revalidatePath("/");
}

function manualRecord(
  issueIdArg: string,
  fields: { title: string; given: string; when: string; then: string; anchor: string; kind: "regression" | "known_bug"; risk: LedgerRecord["risk"] },
  track: "manual" | "imported",
  createdAt: string,
  salt: string
): LedgerRecord {
  return {
    id: recordId(track + salt, fields.title),
    track,
    runId: "manual",
    issueId: issueIdArg,
    perspective: "engineer",
    intensity: "strong",
    codeRef: { path: null, contentHash: "manual" },
    anchor: fields.anchor || "（手動）",
    observation: fields.then || fields.title,
    question: fields.title,
    risk: fields.risk,
    priority: priorityFromRisk(fields.risk),
    kind: "behavior",
    confidence: "high",
    aiAssumption: fields.title,
    status: "confirmed",
    assignee: null,
    declaredIntent: fields.then || fields.title,
    generatedTest: {
      kind: fields.kind,
      title: fields.title,
      given: fields.given,
      when: fields.when,
      then: fields.then,
      rationale: track === "manual" ? "手動追加" : "JSONインポート",
    },
    adopted: true,
    lastVerifiedCodeRef: null,
    createdAt,
    decidedAt: createdAt,
  };
}

// 手動でテスト項目を追加（種別 manual）。
export async function addManualAction(formData: FormData): Promise<void> {
  const issueIdArg = String(formData.get("issueId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!issueIdArg || !title) throw new Error("タイトルが必要です。");
  const createdAt = new Date().toISOString();
  const rec = manualRecord(
    issueIdArg,
    {
      title,
      given: String(formData.get("given") ?? ""),
      when: String(formData.get("when") ?? ""),
      then: String(formData.get("then") ?? ""),
      anchor: String(formData.get("anchor") ?? ""),
      kind: String(formData.get("kind") ?? "regression") === "known_bug" ? "known_bug" : "regression",
      risk: ((): LedgerRecord["risk"] => {
        const v = String(formData.get("risk") ?? "other");
        return ["money", "data", "auth", "irreversible", "critical", "other"].includes(v) ? (v as LedgerRecord["risk"]) : "other";
      })(),
    },
    "manual",
    createdAt,
    createdAt
  );
  const ledger = openLedger();
  try {
    await assertCanEditIssue(ledger, issueIdArg);
    ledger.addRecord(rec);
  } finally {
    ledger.close();
  }
  revalidatePath("/");
}

// JSON 配列でテスト項目を取り込む（種別 imported）。
export async function importJsonAction(formData: FormData): Promise<void> {
  const issueIdArg = String(formData.get("issueId") ?? "");
  if (!issueIdArg) throw new Error("issueId がありません。");
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(formData.get("json") ?? ""));
  } catch {
    throw new Error("JSON の形式が不正です。");
  }
  const items = ImportItem.array().parse(parsed);
  const createdAt = new Date().toISOString();
  const ledger = openLedger();
  try {
    await assertCanEditIssue(ledger, issueIdArg);
    items.forEach((it, i) =>
      ledger.addRecord(manualRecord(issueIdArg, it, "imported", createdAt, `${createdAt}#${i}`))
    );
  } finally {
    ledger.close();
  }
  revalidatePath("/");
}

// 採用/解除。採用時に confirmed/corrected かつ未生成ならテストも生成して項目を完成させる。
export async function adoptAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const adopt = String(formData.get("adopt") ?? "true") === "true";
  if (!id) throw new Error("id がありません。");
  const user = await currentUser();

  const ledger = openLedger();
  try {
    await assertCanEditRecord(ledger, id);
    if (adopt) {
      const rec = ledger.getRecord(id);
      if (!rec) throw new Error("レコードが見つからない。");
      if (rec.status !== "confirmed" && rec.status !== "corrected") {
        throw new Error("先に ✓意図通り / ✗訂正 で承認してから採用してください。");
      }
      if (!rec.generatedTest) {
        const usages: { kind: AiUsageKind; u: Usage }[] = [];
        const test = await generateTest(getClient(), getModel(), rec, (u) => usages.push({ kind: "testgen", u }));
        ledger.setGeneratedTest(id, test);
        saveUsages(ledger, usages, {
          userId: user?.id ?? null,
          projectKey: projectKeyForRecord(ledger, id),
          issueId: rec.issueId,
        });
      }
    }
    ledger.setAdopted(id, adopt);
  } finally {
    ledger.close();
  }
  revalidateItem(id);
}

// ── メンバー管理（招待制・owner/admin のみ。decisions/0018 Phase2）──────────────
async function assertCanManage(ledger: SqliteLedger, projectKey: string): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("ログインが必要です。");
  if (!canManageMembers(roleForProject(ledger, user, projectKey))) {
    throw new Error("メンバーを管理する権限がありません（owner/admin のみ）。");
  }
}

// 既存の登録ユーザーをメールで追加（招待制：未登録は追加できない）。
export async function addMemberAction(formData: FormData): Promise<void> {
  const projectKey = String(formData.get("projectKey") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = MemberRole.parse(String(formData.get("role") ?? "member"));
  if (!projectKey) throw new Error("projectKey がありません。");
  const ledger = openLedger();
  try {
    await assertCanManage(ledger, projectKey);
    const u = ledger.getUserByEmail(email);
    if (!u) {
      // 招待制：登録済みユーザーのみ追加可。未登録は本人にサインアップしてもらう。
      redirect(`/project?p=${projectId(projectKey)}&memberr=notfound`);
    }
    ledger.addMember(projectKey, u!.id, role);
  } finally {
    ledger.close();
  }
  revalidatePath("/project");
  revalidatePath("/");
}

export async function setMemberRoleAction(formData: FormData): Promise<void> {
  const projectKey = String(formData.get("projectKey") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const role = MemberRole.parse(String(formData.get("role") ?? "member"));
  if (!projectKey || !userId) throw new Error("projectKey/userId がありません。");
  const ledger = openLedger();
  try {
    await assertCanManage(ledger, projectKey);
    // 最後の owner を降格させない（プロジェクトが管理者不在にならないように）。
    if (role !== "owner") {
      const owners = ledger.listMembers(projectKey).filter((m) => m.role === "owner");
      if (owners.length === 1 && owners[0]!.userId === userId) {
        throw new Error("最後の owner は降格できません。先に別の owner を追加してください。");
      }
    }
    ledger.setMemberRole(projectKey, userId, role);
  } finally {
    ledger.close();
  }
  revalidatePath("/project");
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const projectKey = String(formData.get("projectKey") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!projectKey || !userId) throw new Error("projectKey/userId がありません。");
  const ledger = openLedger();
  try {
    await assertCanManage(ledger, projectKey);
    const owners = ledger.listMembers(projectKey).filter((m) => m.role === "owner");
    if (owners.length === 1 && owners[0]!.userId === userId) {
      throw new Error("最後の owner は削除できません。");
    }
    ledger.removeMember(projectKey, userId);
  } finally {
    ledger.close();
  }
  revalidatePath("/project");
  revalidatePath("/");
}
