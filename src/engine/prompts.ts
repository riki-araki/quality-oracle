// src/engine/prompts.ts
// プロンプト雛形（docs/prompts/*.md）を単一の真実源として読み込み、コードやインベントリを
// 差し込む。プロンプト文字列をコード内に二重に持たない（CLAUDE.md コーディング方針）。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import type { Perspective, Intensity } from "./schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "..", "..");

const PROMPTS_DIR = join(REPO_ROOT, "docs", "prompts");
const PASS1_TEMPLATE = join(PROMPTS_DIR, "pass1-observation.md");
const PASS2_TEMPLATE = join(PROMPTS_DIR, "pass2-interrogation.md");
const PASS3_TEMPLATE = join(PROMPTS_DIR, "pass3-testgen.md");
const KNOWLEDGE_TEMPLATE = join(PROMPTS_DIR, "knowledge-analysis.md");
const REQUEST_TEMPLATE = join(PROMPTS_DIR, "request-gen.md");
const NORMAL_TEMPLATE = join(PROMPTS_DIR, "normal-gen.md");
const DRIFT_TEMPLATE = join(PROMPTS_DIR, "drift-check.md");
const LESSONS_TEMPLATE = join(PROMPTS_DIR, "lessons-distill.md");
const INVENTORY_PLACEHOLDER = "（ここにインベントリを差し込む）";
const SPECS_PLACEHOLDER = "（ここに承認済み意図を差し込む）";
const CORRECTIONS_PLACEHOLDER = "（ここに訂正履歴を差し込む）";
const LENSES_FILE = join(PROMPTS_DIR, "lenses.md");
const PASS1_PLACEHOLDER = "（ここに対象のソースを貼る）";
const PASS2_PLACEHOLDER = "（ここに Pass 1 の JSON 出力を貼る）";
const PASS3_PLACEHOLDER = "（ここにレコードのJSONを貼る）";
const SUBJECT_PLACEHOLDER = "（ここに観点の主体を差し込む）";
const VIEWPOINTS_PLACEHOLDER = "（ここに観点リストを差し込む）";
const INTENSITY_PLACEHOLDER = "（ここに強度を差し込む）";
const KNOWLEDGE_PLACEHOLDER = "（ここに前提知識を差し込む）";

function knowledgeText(knowledge: string | null | undefined): string {
  return knowledge && knowledge.trim()
    ? knowledge.trim()
    : "（前提知識は与えられていない。コードの記述のみから観測/判断すること。）";
}

export interface Lens {
  perspective: Perspective;
  intensity: Intensity;
}

// lenses.md から <!-- BLOCK key --> … <!-- /BLOCK --> の中身を取り出す（単一の真実源）。
function lensBlock(key: string): string {
  const md = readFileSync(LENSES_FILE, "utf8");
  const re = new RegExp(`<!--\\s*BLOCK ${key.replace(/\./g, "\\.")}\\s*-->([\\s\\S]*?)<!--\\s*/BLOCK\\s*-->`);
  const m = md.match(re);
  if (!m) throw new Error(`レンズ block が見つからない: ${key}（docs/prompts/lenses.md）`);
  return m[1]!.trim();
}

// 雛形 .md から最初の ``` フェンス内（＝プロンプト本体）だけを取り出す。
function extractPrompt(templatePath: string): string {
  const md = readFileSync(templatePath, "utf8");
  const m = md.match(/```[a-zA-Z]*\n([\s\S]*?)\n```/);
  if (!m) throw new Error(`プロンプト本体（コードフェンス）が見つからない: ${templatePath}`);
  return m[1]!;
}

function fillPlaceholder(
  prompt: string,
  placeholder: string,
  value: string,
  templatePath: string
): string {
  if (!prompt.includes(placeholder)) {
    throw new Error(
      `雛形にプレースホルダ「${placeholder}」が見つからない: ${templatePath}\n` +
        `雛形を変更した場合は prompts.ts のプレースホルダ定数も合わせて更新すること。`
    );
  }
  return prompt.replace(placeholder, value);
}

/** Pass1（観測）プロンプト: 観点の主体・前提知識・対象コードを差し込む。 */
export function buildPass1Prompt(code: string, lens: Lens, knowledge?: string | null): string {
  let p = extractPrompt(PASS1_TEMPLATE);
  p = fillPlaceholder(p, SUBJECT_PLACEHOLDER, lensBlock(`perspective.${lens.perspective}.observe`), PASS1_TEMPLATE);
  p = fillPlaceholder(p, KNOWLEDGE_PLACEHOLDER, knowledgeText(knowledge), PASS1_TEMPLATE);
  return fillPlaceholder(p, PASS1_PLACEHOLDER, code, PASS1_TEMPLATE);
}

/** Pass2（尋問）プロンプト: 主体・前提知識・強度・観点リストとインベントリを差し込む。 */
export function buildPass2Prompt(
  inventoryJson: string,
  lens: Lens,
  knowledge?: string | null,
  regression?: boolean
): string {
  let p = extractPrompt(PASS2_TEMPLATE);
  p = fillPlaceholder(p, SUBJECT_PLACEHOLDER, lensBlock(`perspective.${lens.perspective}.observe`), PASS2_TEMPLATE);
  p = fillPlaceholder(p, KNOWLEDGE_PLACEHOLDER, knowledgeText(knowledge), PASS2_TEMPLATE);
  p = fillPlaceholder(p, INTENSITY_PLACEHOLDER, lensBlock(`intensity.${lens.intensity}`), PASS2_TEMPLATE);
  const viewpoints =
    lensBlock(`perspective.${lens.perspective}.viewpoints`) + (regression ? "\n" + lensBlock("regression") : "");
  p = fillPlaceholder(p, VIEWPOINTS_PLACEHOLDER, viewpoints, PASS2_TEMPLATE);
  return fillPlaceholder(p, PASS2_PLACEHOLDER, inventoryJson, PASS2_TEMPLATE);
}

/** Pass3（テスト生成）プロンプト: 承認済みレコードの JSON を差し込む。 */
export function buildPass3Prompt(recordJson: string): string {
  return fillPlaceholder(extractPrompt(PASS3_TEMPLATE), PASS3_PLACEHOLDER, recordJson, PASS3_TEMPLATE);
}

const OVERVIEW_PLACEHOLDER = "（ここに概要を差し込む）";
const SOURCE_PLACEHOLDER = "（ここにソースを差し込む）";

/** AI分析ナレッジ生成プロンプト: 概要とソースを差し込む。 */
export function buildKnowledgePrompt(overview: string, source: string): string {
  let p = extractPrompt(KNOWLEDGE_TEMPLATE);
  p = fillPlaceholder(p, OVERVIEW_PLACEHOLDER, overview || "（概要なし）", KNOWLEDGE_TEMPLATE);
  return fillPlaceholder(p, SOURCE_PLACEHOLDER, source || "（ソースなし）", KNOWLEDGE_TEMPLATE);
}

/** 正常系テスト生成プロンプト: 前提知識とインベントリを差し込む。 */
export function buildNormalPrompt(inventoryJson: string, knowledge?: string | null): string {
  let p = extractPrompt(NORMAL_TEMPLATE);
  p = fillPlaceholder(p, KNOWLEDGE_PLACEHOLDER, knowledgeText(knowledge), NORMAL_TEMPLATE);
  return fillPlaceholder(p, INVENTORY_PLACEHOLDER, inventoryJson, NORMAL_TEMPLATE);
}

/** 意図ドリフト検査プロンプト: 前提知識・承認済み意図・新しい観測インベントリを差し込む。 */
export function buildDriftPrompt(
  specsJson: string,
  inventoryJson: string,
  knowledge?: string | null
): string {
  let p = extractPrompt(DRIFT_TEMPLATE);
  p = fillPlaceholder(p, KNOWLEDGE_PLACEHOLDER, knowledgeText(knowledge), DRIFT_TEMPLATE);
  p = fillPlaceholder(p, SPECS_PLACEHOLDER, specsJson, DRIFT_TEMPLATE);
  return fillPlaceholder(p, INVENTORY_PLACEHOLDER, inventoryJson, DRIFT_TEMPLATE);
}

/** 訂正の資産化プロンプト: ✗訂正の履歴（observation→correctedIntent）を差し込む。 */
export function buildLessonsPrompt(correctionsJson: string): string {
  const p = extractPrompt(LESSONS_TEMPLATE);
  return fillPlaceholder(p, CORRECTIONS_PLACEHOLDER, correctionsJson, LESSONS_TEMPLATE);
}

/** テスト用HTTPリクエスト生成プロンプト: 前提知識とレコードを差し込む。 */
export function buildRequestPrompt(recordJson: string, knowledge?: string | null): string {
  let p = extractPrompt(REQUEST_TEMPLATE);
  p = fillPlaceholder(p, KNOWLEDGE_PLACEHOLDER, knowledgeText(knowledge), REQUEST_TEMPLATE);
  return fillPlaceholder(p, PASS3_PLACEHOLDER, recordJson, REQUEST_TEMPLATE);
}
