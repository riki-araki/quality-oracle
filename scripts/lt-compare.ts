#!/usr/bin/env -S npx tsx
// scripts/lt-compare.ts
// LT用の対照実験。「別セッション/別モデルでレビューすればいいのでは？」への回答を実測で作る。
//
// 同じコード（docs/lt/demo/app.js）に対して、条件だけを変えて比較する:
//   A: 普通のAIレビュー（コードを渡す・よくあるやり方）
//   B: quality-oracle の2段目と“完全に同じプロンプト”に、観測リストではなくコードを入れる
//      → 「読み直せば答えられる質問は消せ」という禁止ルールは入ったまま
//   C: quality-oracle 本来（コードを渡さない）… 既存の run e80ac92ff11e を使う
//
// B が肝。プロンプトの禁止だけで鏡化を防げるなら B と C は同じ結果になるはず。
// 使い方: npx tsx scripts/lt-compare.ts [--model claude-sonnet-4-6]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { REPO_ROOT, buildPass2Prompt } from "../src/engine/prompts";
import type { Lens } from "../src/engine/prompts";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const TARGET = join(REPO_ROOT, "docs", "lt", "demo", "app.js");
const OUT_DIR = join(REPO_ROOT, "docs", "lt", "demo", "compare");

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
    let val = s.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

async function call(client: Anthropic, model: string, prompt: string): Promise<string> {
  const res = await client.messages.create({
    model,
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

async function main(): Promise<void> {
  loadEnvFile(join(REPO_ROOT, ".env"));
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY がありません（.env を確認）");

  const argModel = process.argv.indexOf("--model");
  const model = argModel > -1 ? process.argv[argModel + 1] : process.env.ORACLE_MODEL || DEFAULT_MODEL;

  const code = readFileSync(TARGET, "utf8");
  const client = new Anthropic({ apiKey: key });
  const lens: Lens = { perspective: "director", intensity: "medium" };
  mkdirSync(OUT_DIR, { recursive: true });

  // ── A: 普通のAIレビュー（誰でもやるやり方） ─────────────────────────
  console.log(`[A] 普通のAIレビュー（コードを渡す）… model=${model}`);
  const promptA = `あなたは経験豊富なコードレビュアーです。
以下のコードをレビューして、問題点を指摘してください。

<code>
${code}
</code>`;
  const a = await call(client, model, promptA);
  writeFileSync(join(OUT_DIR, "A-plain-review.md"), `# A. 普通のAIレビュー（コードを渡す）\n\nmodel: ${model}\n\n---\n\n${a}\n`);
  console.log(`    → ${OUT_DIR}/A-plain-review.md`);

  // ── B: 2段目と同じプロンプト＋コード（禁止ルールは入ったまま） ────────
  console.log(`[B] 2段目と同じプロンプトに、観測リストの代わりにコードを入れる…`);
  const promptB = buildPass2Prompt(code, lens, null, false);
  writeFileSync(join(OUT_DIR, "B-prompt-used.txt"), promptB);
  const b = await call(client, model, promptB);
  writeFileSync(join(OUT_DIR, "B-same-prompt-with-code.md"), `# B. 2段目と同じプロンプト ＋ コード\n\nmodel: ${model}\nlens: ${lens.perspective}/${lens.intensity}\n\n※ 「コードを読み直せば答えられる質問は消せ」という禁止ルールは**入ったまま**。\n※ 違いは <inventory> の中身が「観測リスト」ではなく「コード本体」であることだけ。\n\n---\n\n${b}\n`);
  console.log(`    → ${OUT_DIR}/B-same-prompt-with-code.md`);

  console.log(`\n完了。C（コードを渡さない本来の結果）は既存の run e80ac92ff11e を使う:`);
  console.log(`  npx tsx src/cli/oracle.ts report --run e80ac92ff11e`);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
