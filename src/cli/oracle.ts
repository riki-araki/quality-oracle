#!/usr/bin/env -S npx tsx
// src/cli/oracle.ts
// quality-oracle CLI。engine（観測/尋問/台帳）の薄いラッパ。
//   run     コード → 二段パイプライン → 質問JSON を出力し、§6.9 台帳に pending で記録
//   list    台帳のレコードをリスク順に一覧
//   decide  人間の4択（✓/✗/—/?）を1件に適用（§6.7）
//   report  §6.10 指標サマリ
// 設計の正典: docs/design.md。CLI は engine を呼ぶだけで、プロンプトや判断ロジックを持たない。

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { REPO_ROOT } from "../engine/prompts";
import { observe, interrogate, generateTest } from "../engine/pipeline";
import { SqliteLedger } from "../engine/ledger";
import { contentHash, runId } from "../engine/ids";
import { fetchPr, fetchFile } from "../engine/sources/github";
import { deriveFromPath, issueId } from "../engine/issues";
import { ApprovalStatus, Perspective, Intensity } from "../engine/schema";
import type { AuditRun, LedgerRecord } from "../engine/schema";
import type { Lens } from "../engine/prompts";

const DEFAULT_MODEL = "claude-sonnet-4-6"; // docs.claude.com で確認（記憶に頼らない）
const DEFAULT_DB = join(REPO_ROOT, "data", "oracle.db");

const USAGE = `quality-oracle — コード片 → 確認質問 → 承認台帳（§6.9）

使い方:
  tsx src/cli/oracle.ts run <ファイル|-> [オプション]   コード→質問JSON＋台帳に記録
  tsx src/cli/oracle.ts list [オプション]                台帳をリスク順に一覧
  tsx src/cli/oracle.ts decide <id> <status> [--intent "正解"]   4択を適用
  tsx src/cli/oracle.ts gen-tests [--run <id>] [--force]  承認済みの意図→テスト項目を生成（⑤）
  tsx src/cli/oracle.ts report [--run <id>]              §6.10 指標サマリ
  （後方互換: 第1引数がファイルなら run とみなす）

run の入力源（いずれか / 省略時はファイル/標準入力）:
  <ファイル|->            ローカルファイル or 標準入力
  --pr owner/repo#123    GitHub PR の変更ファイル全文を連結して観測（読み取り専用）
  --gh owner/repo:path[@ref]  GitHub 単一ファイルを観測
run オプション:
  --lens <主体>          director（業務/画面）| engineer（実装/技術）。既定 engineer
  --intensity <強度>     loose（最重要だけ）| medium | strong（総当たり）。既定 strong
  --model <id>           既定: env ORACLE_MODEL or ${DEFAULT_MODEL}
  --inventory-out <path> Pass1 観測インベントリJSONを保存（監査用）
  --out <path>           質問JSONを保存（既定: 標準出力）
  --no-store             台帳に保存しない（従来どおり質問JSONだけ）

status（decide）: confirmed | corrected | not_applicable | unknown | pending
  confirmed       ✓意図通り（現状の観測を正解として採用＝回帰テスト）
  corrected       ✗違う→正解（--intent 必須・テスト前に見つけたバグ）
  not_applicable  —テスト不要
  unknown         ?わからない（最重要シグナル）

共通: --db <path>（既定: ${DEFAULT_DB}）
環境変数: ANTHROPIC_API_KEY（必須・.envから読む）/ ORACLE_MODEL`;

// ── .env ローダ（クオート除去・空文字も未設定扱い。env-empty-key 対策）──────────
function loadEnvFile(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq === -1) continue;
    const key = s.slice(0, eq).trim();
    if (!key) continue;
    let val = s.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

// ── 簡易オプションパーサ ──────────────────────────────────────────────────────
function parseFlags(argv: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function readCode(arg: string | undefined): string {
  let code: string;
  if (!arg || arg === "-") code = readFileSync(0, "utf8");
  else code = readFileSync(resolve(process.cwd(), arg), "utf8");
  if (!code.trim()) throw new Error("入力コードが空です（ファイルパスを渡すか標準入力で流す）。");
  return code;
}

function requireKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "環境変数 ANTHROPIC_API_KEY が未設定です（.env に書くか環境変数で渡す。.env.example 参照）。"
    );
  }
  return key;
}

function short(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ── コマンド: run ─────────────────────────────────────────────────────────────
async function cmdRun(positional: string[], flags: Record<string, string | true>): Promise<void> {
  const key = requireKey();
  const model = (flags.model as string) || process.env.ORACLE_MODEL || DEFAULT_MODEL;

  // 入力源: --pr / --gh（GitHub 読み取り専用アダプタ）or ファイル/標準入力。
  const fileArg = positional[0];
  let code: string;
  let codeRefPath: string | null;
  if (typeof flags.pr === "string") {
    const src = await fetchPr(flags.pr, process.env.GITHUB_TOKEN);
    console.error(`GitHub PR ${flags.pr}: ${src.files.length} ファイルを連結（${src.path}）`);
    code = src.code;
    codeRefPath = src.path;
  } else if (typeof flags.gh === "string") {
    const src = await fetchFile(flags.gh, process.env.GITHUB_TOKEN);
    console.error(`GitHub file: ${src.path}`);
    code = src.code;
    codeRefPath = src.path;
  } else {
    code = readCode(fileArg);
    codeRefPath = fileArg && fileArg !== "-" ? fileArg : null;
  }
  if (!code.trim()) throw new Error("入力コードが空です。");

  const lens: Lens = {
    perspective: Perspective.parse((flags.lens as string) || "engineer"),
    intensity: Intensity.parse((flags.intensity as string) || "strong"),
  };

  const client = new Anthropic({ apiKey: key });

  console.error(`[1/2] 観測（Pass1）… model=${model} / 主体=${lens.perspective} 強度=${lens.intensity}`);
  const inventory = await observe(client, model, code, lens);
  console.error(`      → 挙動 ${inventory.length} 件`);
  if (typeof flags["inventory-out"] === "string") {
    writeFileSync(resolve(process.cwd(), flags["inventory-out"]), JSON.stringify(inventory, null, 2));
    console.error(`      → インベントリ保存: ${flags["inventory-out"]}`);
  }

  console.error("[2/2] 尋問（Pass2）…");
  const questions = await interrogate(client, model, inventory, lens);
  console.error(`      → 確認質問 ${questions.length} 件`);

  const createdAt = new Date().toISOString();
  const codeHash = contentHash(code);
  const d = deriveFromPath(codeRefPath);
  const run: AuditRun = {
    id: runId(codeHash, createdAt),
    issueId: issueId(d.projectKey, d.issueKey),
    codeRef: { path: codeRefPath, contentHash: codeHash },
    model,
    perspective: lens.perspective,
    intensity: lens.intensity,
    createdAt,
    inventory,
    questions,
  };

  if (flags["no-store"] !== true) {
    const db = (flags.db as string) || DEFAULT_DB;
    const ledger = new SqliteLedger(db);
    ledger.saveRun(run);
    const seeded = ledger.seedRecords(run);
    ledger.close();
    console.error(`      → 台帳に記録: run=${run.id} / ${seeded.length} レコード（pending） @ ${db}`);
    console.error(`        次: tsx src/cli/oracle.ts list --run ${run.id}`);
  }

  const json = JSON.stringify(questions, null, 2);
  if (typeof flags.out === "string") {
    writeFileSync(resolve(process.cwd(), flags.out), json);
    console.error(`完了: ${flags.out}`);
  } else {
    console.log(json);
  }
}

// ── コマンド: list ────────────────────────────────────────────────────────────
function cmdList(flags: Record<string, string | true>): void {
  const ledger = new SqliteLedger((flags.db as string) || DEFAULT_DB);
  const records = ledger.listRecords({
    runId: typeof flags.run === "string" ? flags.run : undefined,
    status: typeof flags.status === "string" ? ApprovalStatus.parse(flags.status) : undefined,
    risk: typeof flags.risk === "string" ? (flags.risk as never) : undefined,
  });
  ledger.close();

  if (flags.json === true) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }
  if (records.length === 0) {
    console.log("（レコードなし。先に run してください）");
    return;
  }
  const mark: Record<string, string> = {
    pending: "・",
    confirmed: "✓",
    corrected: "✗",
    not_applicable: "—",
    unknown: "?",
  };
  for (const r of records) {
    console.log(
      `${mark[r.status] ?? " "} [${r.risk.padEnd(12)}] ${r.id}  ${short(r.anchor, 38)}`
    );
    console.log(`    ${short(r.question, 96)}`);
  }
  console.log(`\n${records.length} 件。承認: tsx src/cli/oracle.ts decide <id> <status> [--intent "正解"]`);
}

// ── コマンド: decide ──────────────────────────────────────────────────────────
function cmdDecide(positional: string[], flags: Record<string, string | true>): void {
  const [id, statusArg] = positional;
  if (!id || !statusArg) throw new Error("使い方: decide <id> <status> [--intent \"正解\"]");
  const status = ApprovalStatus.parse(statusArg);
  const intent = typeof flags.intent === "string" ? flags.intent : null;

  const ledger = new SqliteLedger((flags.db as string) || DEFAULT_DB);
  const updated: LedgerRecord = ledger.setDecision(id, status, intent);
  ledger.close();

  console.log(`更新: ${updated.id}  status=${updated.status}`);
  if (updated.declaredIntent) console.log(`  宣言した意図: ${updated.declaredIntent}`);
}

// ── コマンド: gen-tests（⑤ 承認済みの意図 → テスト項目）─────────────────────────
async function cmdGenTests(flags: Record<string, string | true>): Promise<void> {
  const key = requireKey();
  const model = (flags.model as string) || process.env.ORACLE_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey: key });
  const ledger = new SqliteLedger((flags.db as string) || DEFAULT_DB);
  try {
    const runId = typeof flags.run === "string" ? flags.run : undefined;
    const targets = ledger
      .listRecords(runId ? { runId } : {})
      .filter((r) => r.status === "confirmed" || r.status === "corrected")
      .filter((r) => flags.force === true || r.generatedTest === null);

    if (targets.length === 0) {
      console.error("対象なし（confirmed/corrected かつ未生成のレコードがありません）。");
      return;
    }
    console.error(`テスト生成: ${targets.length} 件 … model=${model}`);
    let regression = 0;
    let knownBug = 0;
    for (const r of targets) {
      const test = await generateTest(client, model, r);
      ledger.setGeneratedTest(r.id, test);
      if (test.kind === "regression") regression++;
      else knownBug++;
      console.error(`  ${test.kind === "known_bug" ? "✗" : "✓"} ${r.id}  ${test.title}`);
    }
    console.error(`完了: 回帰 ${regression} / 既知バグ ${knownBug}`);
  } finally {
    ledger.close();
  }
}

// ── コマンド: report ──────────────────────────────────────────────────────────
function cmdReport(flags: Record<string, string | true>): void {
  const ledger = new SqliteLedger((flags.db as string) || DEFAULT_DB);
  const m = ledger.metrics(typeof flags.run === "string" ? flags.run : undefined);
  ledger.close();

  console.log("§6.10 指標サマリ");
  console.log(`  総レコード: ${m.total} / 承認済み: ${m.decided}`);
  console.log(`  状態別: ${JSON.stringify(m.byStatus)}`);
  console.log(`  リスク別: ${JSON.stringify(m.byRisk)}`);
  console.log(`  種類別: ${JSON.stringify(m.byKind)}`);
  console.log(`  ✗訂正率（テスト前バグ検出率の近似 §6.10③）: ${(m.correctedRate * 100).toFixed(1)}%`);
  console.log(`  ?不明率（誰も正解を知らない箇所 §6.7）: ${(m.unknownRate * 100).toFixed(1)}%`);
}

// ── エントリポイント ──────────────────────────────────────────────────────────
async function main(): Promise<void> {
  loadEnvFile(join(REPO_ROOT, ".env"));
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help") {
    console.log(USAGE);
    return;
  }

  const known = ["run", "list", "decide", "gen-tests", "report"];
  const sub = known.includes(argv[0]!) ? argv[0]! : "run"; // 後方互換: ファイル指定なら run
  const rest = known.includes(argv[0]!) ? argv.slice(1) : argv;
  const { positional, flags } = parseFlags(rest);

  switch (sub) {
    case "run":
      await cmdRun(positional, flags);
      break;
    case "list":
      cmdList(flags);
      break;
    case "decide":
      cmdDecide(positional, flags);
      break;
    case "gen-tests":
      await cmdGenTests(flags);
      break;
    case "report":
      cmdReport(flags);
      break;
  }
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
