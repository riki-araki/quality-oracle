// app/lib/ui.ts — 表示用のラベル・色。
import type { Risk, ApprovalStatus, Priority } from "@/src/engine/schema";

export const PRIORITY_LABEL: Record<Priority, string> = { high: "高", medium: "中", low: "低" };
// テーマで切り替わるよう CSS 変数を参照（globals.css のトークン）。インライン style で使う。
export const PRIORITY_COLOR: Record<Priority, string> = {
  high: "var(--bad-solid)",
  medium: "var(--warn-solid)",
  low: "var(--neutral)",
};

/** リスク → テーマCSS変数（globals.css の @theme と対応）。 */
export function riskVar(risk: Risk): string {
  return `var(--color-${risk})`;
}

export const RISK_LABEL: Record<Risk, string> = {
  money: "金",
  data: "データ",
  auth: "認証",
  irreversible: "不可逆",
  critical: "重大",
  other: "その他",
};

export const STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: "未レビュー",
  confirmed: "意図通り",
  corrected: "訂正(バグ)",
  not_applicable: "不要",
  unknown: "わからない",
};

export const STATUS_MARK: Record<ApprovalStatus, string> = {
  pending: "•",
  confirmed: "✓",
  corrected: "✗",
  not_applicable: "—",
  unknown: "?",
};

export const KIND_LABEL: Record<"regression" | "known_bug", string> = {
  regression: "回帰",
  known_bug: "既知バグ",
};

export const TRACK_LABEL: Record<"oracle" | "normal" | "manual" | "imported", string> = {
  oracle: "オラクル",
  normal: "正常系",
  manual: "手動",
  imported: "取込",
};

export function shorten(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export const PERSPECTIVE_LABEL: Record<"director" | "engineer", string> = {
  director: "業務（ディレクター）",
  engineer: "技術（エンジニア）",
};

export const INTENSITY_LABEL: Record<"loose" | "medium" | "strong", string> = {
  loose: "強度: 緩い",
  medium: "強度: 中間",
  strong: "強度: 強い",
};

export const RESULT_LABEL: Record<"pass" | "fail" | "blocked", string> = {
  pass: "合格",
  fail: "不合格",
  blocked: "ブロック",
};

export const RESULT_COLOR: Record<"pass" | "fail" | "blocked", string> = {
  pass: "var(--ok-solid)",
  fail: "var(--bad-solid)",
  blocked: "var(--warn-solid)",
};

