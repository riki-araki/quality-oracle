// scripts/export-sample.ts — 試験書（Excel）の見本を書き出す開発用スクリプト。
// UI の Excel出力（app/lib/export.ts）と同じシート生成関数を使うため、フォーマットは本番と同一。
// 認証ゲート（issueWorkbook/projectWorkbook 内の currentUser）を通らないので CLI から実行できる。
//
// 使い方:
//   npx tsx scripts/export-sample.ts [--out <ディレクトリ>] [--project <名前の一部>]
//   既定の出力先は %USERPROFILE%/Downloads、既定の対象は採用済み項目が最も多いプロジェクト。

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import ExcelJS from "exceljs";
import { SqliteLedger } from "../src/engine/ledger";
import { buildTree } from "../app/lib/model";
import { addIssueSheet, addSummarySheet } from "../app/lib/export";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const outDir = flag("out") || join(homedir(), "Downloads");
const wantProject = flag("project");

// ファイル名に使えない文字を落とす（Windows）。
function safeFile(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

const ledger = new SqliteLedger(join(process.cwd(), "data", "oracle.db"));
try {
  const all = buildTree(ledger.listProjects(), ledger.listIssues(), ledger.listRecords({}));
  const tree = wantProject
    ? all.filter((p) => p.label.includes(wantProject) || p.key.includes(wantProject))
    : all;
  // 既定は採用済み項目が最も多いプロジェクト＝見本として中身が詰まっているもの。
  const scored = tree
    .map((p) => ({ p, adopted: p.issues.reduce((n, i) => n + i.records.filter((r) => r.adopted).length, 0) }))
    .sort((a, b) => b.adopted - a.adopted);
  const target = scored[0];
  if (!target || target.adopted === 0) {
    process.stdout.write(
      wantProject
        ? `「${wantProject}」に一致し採用済み項目を持つプロジェクトがありません。\n`
        : "採用済みのテスト項目がありません（見本を作れません）。\n"
    );
    process.exit(0);
  }
  const project = target.p;

  const wb = new ExcelJS.Workbook();
  const used = new Set<string>();
  const hasSummary = addSummarySheet(wb, project, used); // テスト前検出（価値）シート
  for (const issue of project.issues) addIssueSheet(wb, issue, ledger, used);

  const outPath = join(outDir, `${safeFile(project.label)}_試験書サンプル.xlsx`);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  writeFileSync(outPath, buf);

  process.stdout.write(
    `出力: ${outPath}\n` +
      `プロジェクト: ${project.label}\n` +
      `シート: ${wb.worksheets.map((w) => w.name).join(" / ")}\n` +
      `採用済み項目: ${target.adopted} 件 / サマリーシート: ${hasSummary ? "あり" : "なし（判定済みのオラクル記録が無い）"}\n`
  );
} finally {
  ledger.close();
}
