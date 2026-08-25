// src/engine/pipeline.ts
// 二段パイプラインの中核。Pass1（観測）と Pass2（尋問）を別々のAPI呼び出しに分離する
// （design.md §6.4 / CLAUDE.md ガードレール。一発でやらない）。
// LLM 出力は Zod スキーマで実行時検証する（鏡化以前に「形」を保証）。

import type Anthropic from "@anthropic-ai/sdk";
import { buildPass1Prompt, buildPass2Prompt, buildPass3Prompt, buildKnowledgePrompt, buildRequestPrompt, buildNormalPrompt, buildDriftPrompt, buildLessonsPrompt } from "./prompts";
import type { Lens } from "./prompts";
import { Inventory, Questions, Pass3Output, RequestDraft, NormalItem, DriftOutput } from "./schema";
import type { NormalItem as TNormalItem, DriftOutput as TDriftOutput } from "./schema";
import type {
  Inventory as TInventory,
  Questions as TQuestions,
  LedgerRecord,
  TestItem,
} from "./schema";

const MAX_TOKENS = 8192;

/** LLM 使用量（トークン）。管理画面の集計に使う。 */
export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}
export type OnUsage = (u: Usage) => void;

async function callModel(client: Anthropic, model: string, prompt: string, onUsage?: OnUsage): Promise<string> {
  const msg = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });
  if (onUsage) {
    onUsage({ model, inputTokens: msg.usage?.input_tokens ?? 0, outputTokens: msg.usage?.output_tokens ?? 0 });
  }
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// モデル出力から JSON 配列を取り出す。雛形は「JSON配列のみ」を要求するが、
// ```json フェンスや前置きが混じる場合に備えて頑健に抽出する。
function extractJsonArray(text: string, label: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1]!.trim();
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf("[");
    const end = t.lastIndexOf("]");
    if (start !== -1 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new Error(`${label} の出力を JSON として解釈できなかった:\n${text.slice(0, 500)}`);
  }
}

/** Pass 1（観測）: コード → 挙動インベントリ。別呼び出し #1。 */
export async function observe(
  client: Anthropic,
  model: string,
  code: string,
  lens: Lens,
  knowledge?: string | null,
  onUsage?: OnUsage
): Promise<TInventory> {
  const raw = await callModel(client, model, buildPass1Prompt(code, lens, knowledge), onUsage);
  return Inventory.parse(extractJsonArray(raw, "Pass1（観測）"));
}

/** Pass 2（尋問）: インベントリ → 確認質問リスト。別呼び出し #2。 */
export async function interrogate(
  client: Anthropic,
  model: string,
  inventory: TInventory,
  lens: Lens,
  knowledge?: string | null,
  regression?: boolean,
  onUsage?: OnUsage
): Promise<TQuestions> {
  const raw = await callModel(
    client,
    model,
    buildPass2Prompt(JSON.stringify(inventory, null, 2), lens, knowledge, regression),
    onUsage
  );
  return Questions.parse(extractJsonArray(raw, "Pass2（尋問）"));
}

/** 正常系（観測ベース）の回帰テスト項目を生成する。正しさは判断しない（現状固定）。 */
export async function generateNormal(
  client: Anthropic,
  model: string,
  inventory: TInventory,
  knowledge?: string | null,
  onUsage?: OnUsage
): Promise<TNormalItem[]> {
  const raw = await callModel(client, model, buildNormalPrompt(JSON.stringify(inventory, null, 2), knowledge), onUsage);
  return NormalItem.array().parse(extractJsonArray(raw, "正常系生成"));
}

/** 意図ドリフト検査に渡す承認済み意図の1件（台帳の adopted レコードから作る）。 */
export interface DriftSpec {
  recordId: string;
  anchor: string;
  declaredIntent: string;
  /** confirmed=regression（現状固定）/ corrected=known_bug（既知バグ）。文脈として渡す。 */
  kind: "regression" | "known_bug";
}

/**
 * 意図ドリフト検査（§6.2⑥）: 承認済みの意図（declaredIntent）と新しい観測を突き合わせ、
 * 矛盾する箇所だけを返す。正しさは判断しない（新挙動を正とするか回帰かは人間が決める）。
 */
export async function checkDrift(
  client: Anthropic,
  model: string,
  specs: DriftSpec[],
  inventory: TInventory,
  knowledge?: string | null,
  onUsage?: OnUsage
): Promise<TDriftOutput[]> {
  if (specs.length === 0) return [];
  const specsJson = JSON.stringify(specs, null, 2);
  const raw = await callModel(
    client,
    model,
    buildDriftPrompt(specsJson, JSON.stringify(inventory, null, 2), knowledge),
    onUsage
  );
  const out = DriftOutput.array().parse(extractJsonArray(raw, "意図ドリフト検査"));
  // 実在する承認済み意図に結びつく報告だけを採用する（幻の specRecordId を弾く）。
  const known = new Set(specs.map((s) => s.recordId));
  return out.filter((d) => known.has(d.specRecordId));
}

/** テスト用HTTPリクエストの下書き（method/url/headers/body）。人が確認・修正して送信する前提。 */
export async function generateRequest(
  client: Anthropic,
  model: string,
  record: LedgerRecord,
  knowledge?: string | null,
  onUsage?: OnUsage
): Promise<RequestDraft> {
  const input = {
    anchor: record.anchor,
    observation: record.observation,
    question: record.question,
    declaredIntent: record.declaredIntent,
    test: record.generatedTest,
  };
  const raw = await callModel(client, model, buildRequestPrompt(JSON.stringify(input, null, 2), knowledge), onUsage);
  return RequestDraft.parse(extractJsonObject(raw, "リクエスト生成"));
}

/** 訂正の1件（学習ナレッジ抽出の入力）。observation → 人が示した正しい意図。 */
export interface Correction {
  anchor: string;
  observation: string;
  correctedIntent: string;
}

/**
 * 訂正の資産化（decisions/0023）: プロジェクトの ✗訂正 履歴から、繰り返し現れる教訓を抽出する。
 * これはテスト項目ではなく「次の観測に効く前提知識」。出力は人が編集して育てる前提のテキスト。
 */
export async function distillLessons(
  client: Anthropic,
  model: string,
  corrections: Correction[],
  onUsage?: OnUsage
): Promise<string> {
  if (corrections.length === 0) return "";
  const raw = await callModel(client, model, buildLessonsPrompt(JSON.stringify(corrections, null, 2)), onUsage);
  return raw.trim();
}

/** AI分析ナレッジ: 概要＋ソースから、テスト観点作成に効く前提知識（テキスト）を下書きする。 */
export async function analyzeKnowledge(
  client: Anthropic,
  model: string,
  overview: string,
  source: string,
  onUsage?: OnUsage
): Promise<string> {
  return (await callModel(client, model, buildKnowledgePrompt(overview, source), onUsage)).trim();
}

// モデル出力から JSON オブジェクトを取り出す（Pass3 は配列でなく単一オブジェクト）。
function extractJsonObject(text: string, label: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1]!.trim();
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new Error(`${label} の出力を JSON として解釈できなかった:\n${text.slice(0, 500)}`);
  }
}

/**
 * Pass 3（テスト生成）: 承認済みレコード → テスト項目。別呼び出し #3。
 * コードは渡さず、人間が承認した意図(declaredIntent)からテストを起こす（§1.3 回避）。
 * confirmed → regression（意図を固定）, corrected → known_bug（今は落ちる）。
 */
export async function generateTest(
  client: Anthropic,
  model: string,
  record: LedgerRecord,
  onUsage?: OnUsage
): Promise<TestItem> {
  if (record.status !== "confirmed" && record.status !== "corrected") {
    throw new Error(`テスト生成は confirmed / corrected のみ（現在: ${record.status}）`);
  }
  const input = {
    anchor: record.anchor,
    observation: record.observation,
    question: record.question,
    status: record.status,
    declaredIntent: record.declaredIntent,
  };
  const raw = await callModel(client, model, buildPass3Prompt(JSON.stringify(input, null, 2)), onUsage);
  const out = Pass3Output.parse(extractJsonObject(raw, "Pass3（テスト生成）"));
  const kind = record.status === "confirmed" ? "regression" : "known_bug";
  return { ...out, kind };
}
