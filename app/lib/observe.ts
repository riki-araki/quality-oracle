// app/lib/observe.ts — UIから観測（Pass1/Pass2）を起動するサーバー側ヘルパ（decisions/0008）。
// 課題の codeRef から入力源（GitHub/ローカル）を復元し、選んだレンズで候補を生成して台帳に保存する。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { observe, interrogate, generateNormal, checkDrift } from "@/src/engine/pipeline";
import type { Usage, DriftSpec } from "@/src/engine/pipeline";
import type { AiUsageKind } from "@/src/engine/schema";
import type { SqliteLedger } from "@/src/engine/ledger";
import { fetchPr, fetchFile } from "@/src/engine/sources/github";
import { contentHash, runId, recordId } from "@/src/engine/ids";
import { openLedger } from "@/app/lib/db";
import { deriveFromPath, issueId } from "@/src/engine/issues";
import type { Lens } from "@/src/engine/prompts";
import type { AuditRun } from "@/src/engine/schema";

const DEFAULT_MODEL = "claude-sonnet-4-6";

// ドリフト検査の再観測レンズ。回帰の監査なので技術主体・総当たり（engineer/strong）で固定する。
const DRIFT_LENS: Lens = { perspective: "engineer", intensity: "strong" };

/**
 * 観測/尋問に注入する前提知識を組み立てる（decisions/0023）。
 * プロジェクトの学習ナレッジ（訂正の資産化）＋ 課題ごとの AI分析ナレッジ を結合する。
 * これで「過去の訂正から学んだ教訓」が配下すべての観測に効く（使うほど質問が賢くなる）。
 */
export function loadKnowledge(ledger: SqliteLedger, issueId: string): string | null {
  const issue = ledger.getIssue(issueId);
  const issueK = issue?.knowledge ?? null;
  const lessons = issue ? ledger.getProject(issue.projectKey)?.lessons ?? null : null;
  const parts: string[] = [];
  if (lessons && lessons.trim()) parts.push("## これまでの訂正から学んだ教訓（プロジェクト共通）\n" + lessons.trim());
  if (issueK && issueK.trim()) parts.push("## この課題の前提知識\n" + issueK.trim());
  return parts.length ? parts.join("\n\n") : null;
}

/** 収集した LLM 使用量を台帳に記録する（decisions/0021）。 */
export function saveUsages(
  ledger: SqliteLedger,
  usages: { kind: AiUsageKind; u: Usage }[],
  ctx: { userId: string | null; projectKey: string | null; issueId: string | null }
): void {
  for (const { kind, u } of usages) {
    ledger.addAiUsage({
      id: randomUUID(),
      kind,
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      userId: ctx.userId,
      projectKey: ctx.projectKey,
      issueId: ctx.issueId,
      createdAt: new Date().toISOString(),
    });
  }
}

// process.env を優先しつつ、空なら .env を直読み（シェルが空で定義する環境の保険）。
export function envKey(name: string): string | undefined {
  const v = process.env[name];
  if (v && v.trim()) return v;
  try {
    const text = readFileSync(join(process.cwd(), ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith("#")) continue;
      const eq = s.indexOf("=");
      if (eq === -1 || s.slice(0, eq).trim() !== name) continue;
      let val = s.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      return val || undefined;
    }
  } catch {
    /* .env が無い */
  }
  return undefined;
}

export function getClient(): Anthropic {
  const key = envKey("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY が未設定です（.env を確認してください）。");
  return new Anthropic({ apiKey: key });
}

export function getModel(): string {
  return envKey("ORACLE_MODEL") || DEFAULT_MODEL;
}

// GitHub トークン: .env の GITHUB_TOKEN を優先し、無ければローカルの `gh auth token` を使う
// （private リポジトリを PAT 手動作成なしで読むため。ホスト時は GITHUB_TOKEN を設定）。
export function githubToken(): string | undefined {
  const v = envKey("GITHUB_TOKEN");
  if (v) return v;
  try {
    const t = execSync("gh auth token", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return t || undefined;
  } catch {
    return undefined;
  }
}

export async function resolveCode(
  path: string | null,
  token: string | undefined
): Promise<{ code: string; codeRefPath: string | null }> {
  if (path && path.startsWith("gh:")) {
    const body = path.slice(3);
    if (/#\d+/.test(body)) {
      const ref = body.replace(/@.*$/, ""); // owner/repo#123
      const src = await fetchPr(ref, token);
      return { code: src.code, codeRefPath: src.path };
    }
    const src = await fetchFile(body, token); // owner/repo:path[@ref]
    return { code: src.code, codeRefPath: src.path };
  }
  if (path) {
    return { code: readFileSync(join(process.cwd(), path), "utf8"), codeRefPath: path };
  }
  throw new Error("この課題は標準入力由来のため UI から再観測できません。CLI を使ってください。");
}

/** 課題の対象を選んだレンズで再観測し、候補（未採用レコード）を台帳に追加する。 */
export async function runObservation(
  targetPath: string | null,
  lens: Lens,
  issueIdArg?: string,
  regression?: boolean,
  userId?: string | null
): Promise<{ runId: string; count: number }> {
  const client = getClient();
  const model = getModel();
  const { code, codeRefPath } = await resolveCode(targetPath, githubToken());

  // 所属課題（明示リンク）。指定が無ければ codeRef から導出（後方互換）。
  const d = deriveFromPath(codeRefPath);
  const targetIssueId = issueIdArg && issueIdArg.trim() ? issueIdArg : issueId(d.projectKey, d.issueKey);

  // 課題の AI分析ナレッジを前提知識として注入する（あれば）。
  const ledger = openLedger();
  let knowledge: string | null = null;
  try {
    knowledge = loadKnowledge(ledger, targetIssueId);
  } finally {
    ledger.close();
  }

  const usages: { kind: AiUsageKind; u: Usage }[] = [];
  const inventory = await observe(client, model, code, lens, knowledge, (u) => usages.push({ kind: "observe", u }));
  const questions = await interrogate(client, model, inventory, lens, knowledge, regression, (u) =>
    usages.push({ kind: "interrogate", u })
  );

  const createdAt = new Date().toISOString();
  const codeHash = contentHash(code);
  const run: AuditRun = {
    id: runId(codeHash, createdAt),
    issueId: targetIssueId,
    codeRef: { path: codeRefPath, contentHash: codeHash },
    model,
    perspective: lens.perspective,
    intensity: lens.intensity,
    createdAt,
    inventory,
    questions,
  };

  const ledger2 = openLedger();
  try {
    ledger2.saveRun(run);
    const seeded = ledger2.seedRecords(run);
    saveUsages(ledger2, usages, { userId: userId ?? null, projectKey: d.projectKey, issueId: targetIssueId });
    return { runId: run.id, count: seeded.length };
  } finally {
    ledger2.close();
  }
}

/** 正常系（観測ベースの回帰テスト項目）を候補として生成する（decisions/0016）。 */
export async function runNormal(
  targetPath: string | null,
  lens: Lens,
  issueIdArg?: string,
  userId?: string | null
): Promise<{ runId: string; count: number }> {
  const client = getClient();
  const model = getModel();
  const { code, codeRefPath } = await resolveCode(targetPath, githubToken());
  const d = deriveFromPath(codeRefPath);
  const targetIssueId = issueIdArg && issueIdArg.trim() ? issueIdArg : issueId(d.projectKey, d.issueKey);

  const ledger = openLedger();
  let knowledge: string | null = null;
  try {
    knowledge = loadKnowledge(ledger, targetIssueId);
  } finally {
    ledger.close();
  }

  const usages: { kind: AiUsageKind; u: Usage }[] = [];
  const inventory = await observe(client, model, code, lens, knowledge, (u) => usages.push({ kind: "observe", u }));
  const items = await generateNormal(client, model, inventory, knowledge, (u) => usages.push({ kind: "normal", u }));

  const createdAt = new Date().toISOString();
  const codeHash = contentHash(code);
  const rid = runId(codeHash, createdAt);

  const ledger2 = openLedger();
  try {
    ledger2.saveRun({
      id: rid,
      issueId: targetIssueId,
      codeRef: { path: codeRefPath, contentHash: codeHash },
      model,
      perspective: lens.perspective,
      intensity: lens.intensity,
      createdAt,
      inventory,
      questions: [],
    });
    let n = 0;
    for (const it of items) {
      ledger2.addRecord({
        id: recordId(it.anchor, it.title),
        track: "normal",
        runId: rid,
        issueId: targetIssueId,
        perspective: lens.perspective,
        intensity: lens.intensity,
        codeRef: { path: codeRefPath, contentHash: codeHash },
        anchor: it.anchor,
        observation: it.then,
        question: `正常系: ${it.title}`,
        risk: "other",
        priority: "low",
        kind: "behavior",
        confidence: "high",
        aiAssumption: it.title,
        status: "confirmed",
        assignee: null,
        declaredIntent: it.then,
        generatedTest: {
          kind: "regression",
          title: it.title,
          given: it.given,
          when: it.when,
          then: it.then,
          rationale: "正常系（現状の挙動を固定する回帰）",
        },
        adopted: false,
        lastVerifiedCodeRef: null,
        createdAt,
        decidedAt: createdAt,
      });
      n++;
    }
    saveUsages(ledger2, usages, { userId: userId ?? null, projectKey: d.projectKey, issueId: targetIssueId });
    return { runId: rid, count: n };
  } finally {
    ledger2.close();
  }
}

/**
 * 意図ドリフト検査（§6.2⑥・decisions/0022）: 課題の現在コードを再観測し、
 * 承認済みの意図（adopted かつ declaredIntent あり）と矛盾する新挙動を検出して台帳に保存する。
 * 戻り値の specCount=0 は「まだ承認済みの意図が無い（検査対象なし）」を表す。
 */
export async function runDriftCheck(
  targetPath: string | null,
  issueIdArg: string,
  userId?: string | null
): Promise<{ specCount: number; count: number }> {
  const client = getClient();
  const model = getModel();
  const { code, codeRefPath } = await resolveCode(targetPath, githubToken());
  const d = deriveFromPath(codeRefPath);

  // 承認済みの意図（生きた仕様）＝ adopted かつ declaredIntent あり（confirmed/corrected）。
  const ledger = openLedger();
  let knowledge: string | null = null;
  let specs: DriftSpec[] = [];
  try {
    knowledge = loadKnowledge(ledger, issueIdArg);
    specs = ledger
      .listRecords({ issueId: issueIdArg, adopted: true })
      .filter((r) => r.declaredIntent && (r.status === "confirmed" || r.status === "corrected"))
      .map((r) => ({
        recordId: r.id,
        anchor: r.anchor,
        declaredIntent: r.declaredIntent!,
        kind: r.status === "confirmed" ? ("regression" as const) : ("known_bug" as const),
      }));
  } finally {
    ledger.close();
  }
  if (specs.length === 0) return { specCount: 0, count: 0 };

  const usages: { kind: AiUsageKind; u: Usage }[] = [];
  const inventory = await observe(client, model, code, DRIFT_LENS, knowledge, (u) => usages.push({ kind: "observe", u }));
  const findings = await checkDrift(client, model, specs, inventory, knowledge, (u) => usages.push({ kind: "drift", u }));

  const codeHash = contentHash(code);
  const createdAt = new Date().toISOString();
  const byId = new Map(specs.map((s) => [s.recordId, s]));

  const ledger2 = openLedger();
  try {
    ledger2.clearOpenDriftFindings(issueIdArg); // 前回の open を掃いて最新の検査結果に置き換える。
    for (const f of findings) {
      const spec = byId.get(f.specRecordId);
      if (!spec) continue;
      ledger2.addDriftFinding({
        id: randomUUID(),
        issueId: issueIdArg,
        specRecordId: f.specRecordId,
        anchor: f.anchor,
        approvedIntent: spec.declaredIntent,
        newObservation: f.newObservation,
        contradiction: f.contradiction,
        severity: f.severity,
        codeHash,
        status: "open",
        createdAt,
      });
    }
    saveUsages(ledger2, usages, { userId: userId ?? null, projectKey: d.projectKey, issueId: issueIdArg });
    return { specCount: specs.length, count: findings.length };
  } finally {
    ledger2.close();
  }
}
