// app/lib/export.ts — 課題/プロジェクトを Excel(.xlsx) に出力（decisions/0011）。
// 1課題=1シート。試験項目＋証跡画像（各セルにフィット）。見やすい整形（色・枠・固定・フィルタ）。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { openLedger } from "@/app/lib/db";
import { buildTree } from "@/app/lib/model";
import { TRACK_LABEL, PRIORITY_LABEL, RISK_LABEL } from "@/app/lib/ui";
import { currentUser, roleForProject } from "@/app/lib/access";
import type { IssueNode, ProjectNode } from "@/app/lib/model";
import type { Risk } from "@/src/engine/schema";
import type { SqliteLedger } from "@/src/engine/ledger";

const RES: Record<string, string> = { pass: "合格", fail: "不合格", blocked: "ブロック" };
const IMG_EXT: Record<string, "png" | "jpeg" | "gif"> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
};

const KIND_FILL: Record<string, string> = { regression: "FFDCFCE7", known_bug: "FFFEE2E2" };
const RES_FILL: Record<string, string> = { 合格: "FFDCFCE7", 不合格: "FFFEE2E2", ブロック: "FFFEF3C7", 未実施: "FFF3F4F6" };
const RISK_FILL: Record<string, string> = {
  money: "FFFEE2E2",
  irreversible: "FFFFEDD5",
  auth: "FFFEF9C3",
  data: "FFDBEAFE",
  critical: "FFEDE9FE",
  other: "FFF3F4F6",
};

const THIN = { style: "thin" as const, color: { argb: "FFD1D5DB" } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const solid = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });

const MAX_EV_COLS = 5;

function safeSheetName(name: string, used: Set<string>): string {
  const base = (name.replace(/[:\\/?*[\]]/g, " ").trim() || "課題").slice(0, 26);
  let n = base;
  let i = 2;
  while (used.has(n)) n = `${base.slice(0, 22)} (${i++})`;
  used.add(n);
  return n;
}

export function addIssueSheet(wb: ExcelJS.Workbook, issue: IssueNode, ledger: SqliteLedger, used: Set<string>): void {
  const ws = wb.addWorksheet(safeSheetName(issue.label, used), {
    views: [{ showGridLines: false }],
  });

  const adopted = issue.records.filter((r) => r.adopted);
  const evByRec = new Map(adopted.map((r) => [r.id, ledger.listEvidence(r.id).filter((e) => IMG_EXT[e.mime])]));
  const results = ledger.latestResults(adopted.map((r) => r.id));
  const maxEv = Math.min(MAX_EV_COLS, Math.max(0, ...adopted.map((r) => evByRec.get(r.id)!.length)));

  // テキスト証跡（HTTP送受信など）の内容を読み込む。
  const textByRec = new Map<string, string>();
  for (const r of adopted) {
    const texts: string[] = [];
    for (const e of ledger.listEvidence(r.id)) {
      if (IMG_EXT[e.mime]) continue;
      const f = ledger.getEvidenceFile(e.id);
      if (!f) continue;
      try {
        const s = readFileSync(join(process.cwd(), f.storedPath), "utf8");
        texts.push(s.length > 4000 ? s.slice(0, 4000) + "\n…(truncated)" : s);
      } catch {
        /* skip */
      }
    }
    if (texts.length) textByRec.set(r.id, texts.join("\n\n----\n\n"));
  }
  const hasText = textByRec.size > 0;

  const baseHeaders = ["No", "由来", "優先", "種別", "リスク", "タイトル", "Given", "When", "Then", "宣言した意図", "最新結果", "結果履歴"];
  const headers = [
    ...baseHeaders,
    ...Array.from({ length: maxEv }, (_, i) => `証跡${i + 1}`),
    ...(hasText ? ["送受信・テキスト証跡"] : []),
  ];
  const evStart0 = baseHeaders.length; // 0-indexed 証跡（画像）開始列
  const textCol0 = baseHeaders.length + maxEv; // 0-indexed テキスト証跡列
  const widths = [4, 8, 6, 9, 8, 30, 24, 24, 32, 32, 9, 26, ...Array(maxEv).fill(24), ...(hasText ? [48] : [])];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  // タイトル行（結合）
  ws.mergeCells(1, 1, 1, headers.length);
  const title = ws.getCell(1, 1);
  title.value = issue.label;
  title.font = { bold: true, size: 14, color: { argb: "FF111827" } };
  title.alignment = { vertical: "middle" };
  ws.getRow(1).height = 24;

  let cursor = 2;
  if (issue.overview) {
    ws.mergeCells(cursor, 1, cursor, headers.length);
    const c = ws.getCell(cursor, 1);
    c.value = `概要: ${issue.overview}`;
    c.alignment = { vertical: "top", wrapText: true };
    c.font = { color: { argb: "FF6B7280" } };
    cursor++;
  }
  cursor++; // 空行

  // ヘッダー行
  const headerIdx = cursor;
  const headerRow = ws.getRow(headerIdx);
  headers.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = solid("FF374151");
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = BORDER;
  });
  headerRow.height = 20;
  cursor++;

  let no = 1;
  for (const r of adopted) {
    const t = r.generatedTest;
    const hist = ledger
      .listResults(r.id)
      .map((h) => `${h.executedAt} ${RES[h.status]}${h.note ? ` (${h.note})` : ""}`)
      .join("\n");
    const latest = results[r.id] ? RES[results[r.id]!] ?? "未実施" : "未実施";
    const vals = [
      no++,
      TRACK_LABEL[r.track],
      PRIORITY_LABEL[r.priority],
      t ? (t.kind === "known_bug" ? "既知バグ" : "回帰") : "",
      r.risk,
      t ? t.title : r.question,
      t?.given ?? "",
      t?.when ?? "",
      t?.then ?? "",
      r.declaredIntent ?? "",
      latest,
      hist,
    ];
    const row = ws.getRow(cursor);
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.border = BORDER;
      c.alignment = { vertical: "top", wrapText: true, horizontal: i === 0 ? "center" : "left" };
    });
    row.getCell(1).font = { color: { argb: "FF6B7280" } };
    if (t) row.getCell(4).fill = solid(KIND_FILL[t.kind]!);
    if (RISK_FILL[r.risk]) row.getCell(5).fill = solid(RISK_FILL[r.risk]!);
    row.getCell(6).font = { bold: true };
    if (RES_FILL[latest]) (row.getCell(11).fill = solid(RES_FILL[latest]!)), (row.getCell(11).alignment = { vertical: "top", horizontal: "center" });

    // 証跡画像を各セルにフィット（tl/br の1セルアンカー）
    const imgs = evByRec.get(r.id) ?? [];
    let placed = 0;
    for (const e of imgs.slice(0, maxEv)) {
      const f = ledger.getEvidenceFile(e.id);
      if (!f) continue;
      try {
        const base64 = readFileSync(join(process.cwd(), f.storedPath)).toString("base64");
        const imgId = wb.addImage({ base64, extension: IMG_EXT[e.mime]! });
        const col0 = evStart0 + placed;
        ws.getCell(cursor, col0 + 1).border = BORDER;
        ws.addImage(imgId, {
          tl: { col: col0 + 0.08, row: cursor - 1 + 0.08 } as ExcelJS.Anchor,
          br: { col: col0 + 0.92, row: cursor - 1 + 0.92 } as ExcelJS.Anchor,
        });
        placed++;
      } catch {
        /* 読めない証跡はスキップ */
      }
    }
    // 空の証跡セルにも枠線
    for (let k = placed; k < maxEv; k++) ws.getCell(cursor, evStart0 + k + 1).border = BORDER;
    if (placed > 0) row.height = 96;

    // 送受信・テキスト証跡（HTTP送受信など）
    if (hasText) {
      const tc = row.getCell(textCol0 + 1);
      tc.value = textByRec.get(r.id) ?? "";
      tc.border = BORDER;
      tc.alignment = { vertical: "top", wrapText: true };
      tc.font = { name: "Consolas", size: 9 };
    }

    cursor++;
  }

  if (adopted.length === 0) {
    ws.mergeCells(cursor, 1, cursor, headers.length);
    ws.getCell(cursor, 1).value = "（採用済みのテスト項目はありません）";
    ws.getCell(cursor, 1).font = { color: { argb: "FF9CA3AF" } };
  } else {
    ws.views = [{ state: "frozen", ySplit: headerIdx, showGridLines: false }];
    ws.autoFilter = { from: { row: headerIdx, column: 1 }, to: { row: headerIdx, column: baseHeaders.length } };
  }
}

// 「テスト前検出（オラクルの価値・§6.10③）」サマリーシート。
// テスト実行前に人の承認で見つかった欠陥(✗訂正)・仕様の穴(?不明)を数字＋中身で示す。
export function addSummarySheet(wb: ExcelJS.Workbook, project: ProjectNode, used: Set<string>): boolean {
  const oracle = project.issues.flatMap((iss) => iss.records.filter((r) => r.track === "oracle"));
  const decided = oracle.filter((r) => r.status !== "pending").length;
  if (decided === 0) return false; // 報告するものが無ければシートを作らない

  const corrected = oracle.filter((r) => r.status === "corrected").length;
  const unknown = oracle.filter((r) => r.status === "unknown").length;
  const confirmed = oracle.filter((r) => r.status === "confirmed").length;
  const rate = decided ? Math.round((corrected / decided) * 100) : 0;

  const byRisk = new Map<string, number>();
  const findings = project.issues.flatMap((iss) =>
    iss.records
      .filter((r) => r.track === "oracle" && (r.status === "corrected" || r.status === "unknown"))
      .map((r) => ({ rec: r, issueLabel: iss.label }))
  );
  for (const { rec } of findings) byRisk.set(rec.risk, (byRisk.get(rec.risk) ?? 0) + 1);
  findings.sort((a, b) => (a.rec.status === "corrected" ? 0 : 1) - (b.rec.status === "corrected" ? 0 : 1));

  const ws = wb.addWorksheet(safeSheetName("テスト前検出", used), { views: [{ showGridLines: false }] });
  [12, 12, 26, 46, 46, 22].forEach((w, i) => (ws.getColumn(i + 1).width = w));

  let cursor = 1;
  const mergeRow = (text: string, font: Partial<ExcelJS.Font>, height?: number) => {
    ws.mergeCells(cursor, 1, cursor, 6);
    const c = ws.getCell(cursor, 1);
    c.value = text;
    c.font = font;
    c.alignment = { vertical: "top", wrapText: true };
    if (height) ws.getRow(cursor).height = height;
    cursor++;
  };

  mergeRow(`${project.label} — テスト前検出レポート`, { bold: true, size: 14, color: { argb: "FF111827" } }, 24);
  mergeRow(
    "テストを1行も走らせる前に、人の承認で見つかった欠陥（✗訂正）・仕様の穴（?不明）です（§6.8）。集計はオラクル由来の項目のみ。",
    { color: { argb: "FF6B7280" }, size: 9 },
    28
  );
  cursor++;

  // 指標ブロック（ラベル/値）
  mergeRow("指標", { bold: true, size: 11, color: { argb: "FF374151" } });
  const metrics: [string, string | number, string?][] = [
    ["テスト前に見つけた問題", corrected + unknown],
    ["✗ 訂正（バグ）", corrected, "FFFEE2E2"],
    ["? 不明（穴）", unknown, "FFFEF3C7"],
    ["✓ 意図通り", confirmed, "FFDCFCE7"],
    ["✗訂正率", `${rate}%（${corrected} / ${decided}）`],
  ];
  for (const [label, val, fill] of metrics) {
    const lc = ws.getCell(cursor, 1);
    lc.value = label;
    lc.font = { bold: true };
    lc.border = BORDER;
    ws.mergeCells(cursor, 2, cursor, 3);
    const vc = ws.getCell(cursor, 2);
    vc.value = val;
    vc.border = BORDER;
    if (fill) vc.fill = solid(fill);
    cursor++;
  }
  cursor++;

  // リスク領域別
  if (byRisk.size > 0) {
    mergeRow("リスク領域別（✗訂正・?不明）", { bold: true, size: 11, color: { argb: "FF374151" } });
    for (const [risk, n] of [...byRisk.entries()].sort((a, b) => b[1] - a[1])) {
      const rc = ws.getCell(cursor, 1);
      rc.value = RISK_LABEL[risk as Risk] ?? risk;
      rc.border = BORDER;
      if (RISK_FILL[risk]) rc.fill = solid(RISK_FILL[risk]!);
      const nc = ws.getCell(cursor, 2);
      nc.value = n;
      nc.border = BORDER;
      cursor++;
    }
    cursor++;
  }

  // 見つかった問題の中身
  mergeRow(`見つかった問題の中身（${findings.length}）`, { bold: true, size: 11, color: { argb: "FF374151" } });
  const headers = ["種別", "リスク", "課題", "観測（実際の挙動）", "正しくは / AI推測", "対象"];
  const hr = ws.getRow(cursor);
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = solid("FF374151");
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = BORDER;
  });
  hr.height = 20;
  const headerRowIdx = cursor;
  cursor++;

  for (const { rec, issueLabel } of findings) {
    const correction = rec.status === "corrected" ? rec.declaredIntent ?? "" : `AI推測: ${rec.aiAssumption}`;
    const vals = [
      rec.status === "corrected" ? "✗ 訂正" : "? 不明",
      RISK_LABEL[rec.risk] ?? rec.risk,
      issueLabel,
      rec.observation,
      correction,
      rec.anchor,
    ];
    const row = ws.getRow(cursor);
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.border = BORDER;
      c.alignment = { vertical: "top", wrapText: true };
    });
    row.getCell(1).fill = solid(rec.status === "corrected" ? "FFFEE2E2" : "FFFEF3C7");
    row.getCell(1).font = { bold: true };
    if (RISK_FILL[rec.risk]) row.getCell(2).fill = solid(RISK_FILL[rec.risk]!);
    const maxLen = Math.max(rec.observation.length, correction.length);
    row.height = Math.min(160, Math.max(28, Math.ceil(maxLen / 44) * 14));
    cursor++;
  }

  ws.autoFilter = { from: { row: headerRowIdx, column: 1 }, to: { row: headerRowIdx, column: 6 } };
  return true;
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function issueWorkbook(issueId: string): Promise<{ buffer: Buffer; name: string } | null> {
  const user = await currentUser();
  if (!user) return null;
  const ledger = openLedger();
  try {
    const tree = buildTree(ledger.listProjects(), ledger.listIssues(), ledger.listRecords({}));
    const owner = tree.find((p) => p.issues.some((x) => x.id === issueId));
    const issue = owner?.issues.find((x) => x.id === issueId);
    if (!owner || !issue) return null;
    if (!roleForProject(ledger, user, owner.key)) return null; // アクセス権なし → 404
    const wb = new ExcelJS.Workbook();
    addIssueSheet(wb, issue, ledger, new Set());
    return { buffer: await toBuffer(wb), name: `${issue.label}.xlsx` };
  } finally {
    ledger.close();
  }
}

export async function projectWorkbook(projectId: string): Promise<{ buffer: Buffer; name: string } | null> {
  const user = await currentUser();
  if (!user) return null;
  const ledger = openLedger();
  try {
    const tree = buildTree(ledger.listProjects(), ledger.listIssues(), ledger.listRecords({}));
    const project = tree.find((x) => x.id === projectId);
    if (!project) return null;
    if (!roleForProject(ledger, user, project.key)) return null; // アクセス権なし → 404
    const wb = new ExcelJS.Workbook();
    const used = new Set<string>();
    addSummarySheet(wb, project, used); // テスト前検出（価値）を先頭シートに
    for (const issue of project.issues) addIssueSheet(wb, issue, ledger, used);
    return { buffer: await toBuffer(wb), name: `${project.label}.xlsx` };
  } finally {
    ledger.close();
  }
}
