#!/usr/bin/env -S npx tsx
// scripts/lt-scale-probe.ts
// 「コードを隠す意味があるのか」を、規模を変えて確かめる探り。
//
//   C: 観測 → 質問（コードを渡さない＝本来の2段構成）
//   B: 質問（コードを直接渡す＝1段）
//
// 指標は「識別子混入率」。質問文に、ソース中の識別子（関数名・変数名・型名など）が
// 1つでも入っていれば「技術の言葉」とみなす。**AIには判定させない**（機械的に数える）。
//
// 使い方: npx tsx scripts/lt-scale-probe.ts <対象ファイル> [--lens director]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { REPO_ROOT, buildPass2Prompt } from "../src/engine/prompts";
import type { Lens } from "../src/engine/prompts";
import { observe, interrogate } from "../src/engine/pipeline";

const MODEL = process.env.ORACLE_MODEL || "claude-sonnet-4-6";
const OUT_DIR = join(REPO_ROOT, "docs", "lt", "demo", "compare");

function loadEnv(): void {
  let t: string;
  try { t = readFileSync(join(REPO_ROOT, ".env"), "utf8"); } catch { return; }
  for (const line of t.split(/\r?\n/)) {
    const s = line.trim(); if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("="); if (eq === -1) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

// ソース中の識別子を集める（4文字以上・英数字。ありふれた英単語は除く）
const STOP = new Set(["const","function","return","await","async","true","false","null","undefined","import","export","from","this","type","interface","string","number","boolean","void","class","extends","default","catch","throw","else","then","case","break","filter","length","push","json","body","data","name","value","index","item","list","text","line","code","file","path","test","user"]);
function identifiers(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]{3,}\b/g)) {
    const w = m[0];
    if (STOP.has(w.toLowerCase())) continue;
    out.add(w);
  }
  return out;
}
function techScore(question: string, ids: Set<string>): string[] {
  const hits: string[] = [];
  for (const id of ids) {
    // 単語境界で照合（日本語文中でも英字トークンとして現れる）
    if (new RegExp("(^|[^A-Za-z0-9_$])" + id.replace(/[$]/g, "\\$") + "([^A-Za-z0-9_$]|$)").test(question)) hits.push(id);
  }
  return hits;
}

async function main(): Promise<void> {
  loadEnv();
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY がありません");
  const target = process.argv[2];
  if (!target) throw new Error("使い方: npx tsx scripts/lt-scale-probe.ts <対象ファイル>");
  const li = process.argv.indexOf("--lens");
  const lens: Lens = { perspective: (li > -1 ? process.argv[li + 1] : "director") as Lens["perspective"], intensity: "medium" };

  const code = readFileSync(join(REPO_ROOT, target), "utf8");
  const ids = identifiers(code);
  const client = new Anthropic({ apiKey: key });
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`対象: ${target}  ${code.split(/\n/).length}行 / ${code.length}字 / 識別子 ${ids.size}種`);
  console.log(`レンズ: ${lens.perspective}/${lens.intensity}  model=${MODEL}\n`);

  // ── C: 観測 → 質問（コードを渡さない） ──────────────────────────────
  console.log("[C] 観測（Pass1）…");
  const inv = await observe(client, MODEL, code, lens, null);
  console.log(`    観測 ${inv.length} 件`);
  console.log("[C] 質問（Pass2・観測リストのみ）…");
  const qC = await interrogate(client, MODEL, inv, lens, null, false);
  console.log(`    質問 ${qC.length} 件`);

  // ── B: 質問（コードを直接渡す） ────────────────────────────────────
  console.log("[B] 質問（同じプロンプト＋コード）…");
  const res = await client.messages.create({
    model: MODEL, max_tokens: 8000,
    messages: [{ role: "user", content: buildPass2Prompt(code, lens, null, false) }],
  });
  const raw = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n");
  const m = raw.match(/\[[\s\S]*\]/);
  const qB: Array<{ question: string; anchor?: string }> = m ? JSON.parse(m[0]) : [];
  console.log(`    質問 ${qB.length} 件\n`);

  // ── 指標 ───────────────────────────────────────────────────────────
  const rows: string[] = [];
  const report = (label: string, qs: Array<{ question: string }>) => {
    const hits = qs.map((q) => techScore(q.question, ids));
    const withTech = hits.filter((h) => h.length > 0).length;
    const rate = qs.length ? Math.round((withTech / qs.length) * 100) : 0;
    console.log(`${label}: ${qs.length}件中 ${withTech}件に識別子 → 識別子混入率 ${rate}%`);
    qs.forEach((q, i) => {
      if (hits[i].length) rows.push(`- [${label}] ${hits[i].slice(0, 4).join(", ")} … ${q.question.slice(0, 70)}`);
    });
    return { n: qs.length, withTech, rate };
  };
  const rC = report("C（コードなし）", qC);
  const rB = report("B（コードあり）", qB);

  const md = [
    `# 規模を変えた探り — ${basename(target)}`, "",
    `- 対象: \`${target}\`（${code.split(/\n/).length}行 / ${code.length}字 / 識別子 ${ids.size}種）`,
    `- レンズ: ${lens.perspective}/${lens.intensity} / model: ${MODEL}`,
    `- 指標: **識別子混入率**（質問文にソース中の識別子が1つでも含まれる割合）。AIには判定させず機械的に計数。`, "",
    "| 条件 | 入力 | 質問数 | 識別子を含む | 混入率 |", "|---|---|---|---|---|",
    `| **C** | 観測リストのみ | ${rC.n} | ${rC.withTech} | **${rC.rate}%** |`,
    `| **B** | コード本体 | ${rB.n} | ${rB.withTech} | **${rB.rate}%** |`, "",
    "## 識別子が入っていた質問", "", ...(rows.length ? rows : ["（なし）"]), "",
    "## C の質問（全件）", "", ...qC.map((q, i) => `${i + 1}. ${q.question}`), "",
    "## B の質問（全件）", "", ...qB.map((q, i) => `${i + 1}. ${q.question}`), "",
  ].join("\n");
  const out = join(OUT_DIR, `scale-${basename(target).replace(/\W+/g, "-")}.md`);
  writeFileSync(out, md);
  console.log(`\n→ ${out}`);
}

main().catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
