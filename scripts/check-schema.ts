// scripts/check-schema.ts
// スキーマ（src/engine/schema.ts）が実際のパイプライン出力と一致することを検証する。
// 既存の out/inventory.json（Pass1）と out/questions.json（Pass2）を読み、
// Inventory / Questions スキーマで parse できるか確認する。
//   実行: npm run check:schema
// 出力ファイルが無い場合はスキップ（先に `node src/oracle.mjs samples/checkout.js ...` を実行）。

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Inventory, Questions } from "../src/engine/schema";

function check(label: string, file: string, schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown; data?: unknown } }) {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), file), "utf8");
  } catch {
    console.log(`SKIP  ${label}: ${file} が無い（先にCLIを実行してください）`);
    return true;
  }
  const parsed = schema.safeParse(JSON.parse(raw));
  if (parsed.success) {
    const n = Array.isArray(parsed.data) ? parsed.data.length : 0;
    console.log(`OK    ${label}: ${file}（${n} 件）がスキーマに適合`);
    return true;
  }
  console.error(`FAIL  ${label}: ${file} がスキーマに不適合`);
  console.error(JSON.stringify(parsed.error, null, 2));
  return false;
}

const pass1Ok = check("Pass1 Inventory", "out/inventory.json", Inventory);
const pass2Ok = check("Pass2 Questions", "out/questions.json", Questions);

process.exit(pass1Ok && pass2Ok ? 0 : 1);
