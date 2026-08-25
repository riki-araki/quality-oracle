// app/lib/model.ts — 明示課題（issue_meta）と、レコードの codeRef から導出される課題を
// 「同じ id」で統合して Project→課題→項目 のツリーを作る（decisions/0010）。

import { deriveFromPath, projectId } from "@/src/engine/issues";
import type { SourceKind } from "@/src/engine/issues";
import type { LedgerRecord, Issue, Project } from "@/src/engine/schema";

export interface IssueNode {
  id: string;
  key: string;
  label: string;
  kind: SourceKind;
  sourceRef: string | null;
  overview: string | null;
  knowledge: string | null;
  createdAt: string;
  records: LedgerRecord[];
}
export interface ProjectNode {
  id: string;
  key: string;
  label: string;
  issues: IssueNode[];
}

/** 明示プロジェクト・明示課題・全 records からツリーを構築（records は issueId で明示リンク）。 */
export function buildTree(projects: Project[], issues: Issue[], records: LedgerRecord[]): ProjectNode[] {
  // レコードを明示 issueId でグループ化。
  const recsByIssue = new Map<string, LedgerRecord[]>();
  for (const r of records) {
    const arr = recsByIssue.get(r.issueId) ?? [];
    arr.push(r);
    recsByIssue.set(r.issueId, arr);
  }

  const metaById = new Map<string, Issue>();
  for (const m of issues) metaById.set(m.id, m);
  const projMetaByKey = new Map<string, Project>();
  for (const p of projects) projMetaByKey.set(p.key, p);

  const allIssueIds = new Set<string>([...recsByIssue.keys(), ...metaById.keys()]);

  // projectKey -> { label, issues }
  const projMap = new Map<string, { label: string; issues: IssueNode[] }>();
  const ensureProject = (key: string, label: string) => {
    if (!projMap.has(key)) projMap.set(key, { label, issues: [] });
    return projMap.get(key)!;
  };

  for (const id of allIssueIds) {
    const meta = metaById.get(id);
    const recs = recsByIssue.get(id) ?? [];
    const d = deriveFromPath(meta?.sourceRef ?? recs[0]?.codeRef.path ?? null);
    const createdAt = meta?.createdAt ?? recs.map((r) => r.createdAt).sort().slice(-1)[0] ?? "";
    const node: IssueNode = {
      id,
      key: d.issueKey,
      label: meta?.title ?? d.label,
      kind: meta?.sourceKind ?? d.sourceKind,
      sourceRef: meta?.sourceRef ?? d.sourceRef,
      overview: meta?.overview ?? null,
      knowledge: meta?.knowledge ?? null,
      createdAt,
      records: recs,
    };
    const pKey = meta?.projectKey ?? d.projectKey;
    const pLabel = projMetaByKey.get(pKey)?.label ?? meta?.projectLabel ?? d.projectLabel;
    ensureProject(pKey, pLabel).issues.push(node);
  }

  // 明示プロジェクト（課題ゼロでも表示）。
  for (const p of projects) ensureProject(p.key, p.label);

  const result: ProjectNode[] = [];
  for (const [pKey, proj] of projMap) {
    proj.issues.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    result.push({
      id: projectId(pKey),
      key: pKey,
      label: projMetaByKey.get(pKey)?.label ?? proj.label,
      issues: proj.issues,
    });
  }
  result.sort((a, b) => a.label.localeCompare(b.label));
  return result;
}

const RISK_ORDER: Record<string, number> = {
  money: 0,
  irreversible: 1,
  auth: 2,
  data: 3,
  critical: 4,
  other: 5,
};

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** ✓スルー対策の並び: 未レビューを上に、confidence=low を最優先、その後 優先度 → リスク順。 */
export function sortForReview(records: LedgerRecord[]): LedgerRecord[] {
  return [...records].sort((a, b) => {
    const ap = a.status === "pending" ? 0 : 1;
    const bp = b.status === "pending" ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const al = a.confidence === "low" ? 0 : 1;
    const bl = b.confidence === "low" ? 0 : 1;
    if (al !== bl) return al - bl;
    const apr = PRIORITY_ORDER[a.priority] ?? 1;
    const bpr = PRIORITY_ORDER[b.priority] ?? 1;
    if (apr !== bpr) return apr - bpr;
    return (RISK_ORDER[a.risk] ?? 9) - (RISK_ORDER[b.risk] ?? 9);
  });
}

// ── 質問の情報量（decisions/0024）─────────────────────────────────────────────
// 人の承認予算は有限。当たりそうな質問（AIが不確か・矛盾/抜け・高リスク）を上に、
// 鏡に近い低情報（AIが高確信・単なる挙動・低リスク）を下げる（✓スルー抑止）。
const KIND_INFO: Record<string, number> = {
  contradiction: 3, // §6.6 矛盾 = 最も情報量が高い
  omission: 2, // 抜け
  precondition: 2, // 前提条件
  boundary: 1, // 境界
  behavior: 0, // 単なる挙動 = 鏡になりやすい
};
const HIGH_RISK = new Set(["money", "auth", "irreversible", "critical"]);

/** 情報量スコア（高いほど人が見るべき）: 低確信・矛盾/抜け・高リスクを加点。 */
export function infoScore(r: LedgerRecord): number {
  const conf = r.confidence === "low" ? 3 : r.confidence === "med" ? 1 : 0;
  const kind = KIND_INFO[r.kind] ?? 0;
  const risk = HIGH_RISK.has(r.risk) ? 2 : r.risk === "data" ? 1 : 0;
  return conf + kind + risk;
}

/** 鏡に近い低情報の候補: AIが高確信・種別=挙動・低リスク（＝コードの言い換えに近い）。 */
export function isLowInfo(r: LedgerRecord): boolean {
  return r.confidence === "high" && r.kind === "behavior" && !HIGH_RISK.has(r.risk);
}

/** 情報量順（未レビュー優先 → 情報量スコア降順 → リスク順）。 */
export function sortByInfo(records: LedgerRecord[]): LedgerRecord[] {
  return [...records].sort((a, b) => {
    const ap = a.status === "pending" ? 0 : 1;
    const bp = b.status === "pending" ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const d = infoScore(b) - infoScore(a);
    if (d !== 0) return d;
    return (RISK_ORDER[a.risk] ?? 9) - (RISK_ORDER[b.risk] ?? 9);
  });
}
