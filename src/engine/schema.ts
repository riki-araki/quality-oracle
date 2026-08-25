// src/engine/schema.ts
//
// quality-oracle のデータ契約（単一の真実源）。
// Pass1（観測）/ Pass2（尋問）の LLM 出力形と、§6.9 の「生きた仕様」台帳レコードを
// Zod で一元定義する。engine・CLI・将来の Next.js UI・将来の DB がこの型を共有する。
//
// 対応する設計: docs/design.md
//   §6.2 全体ループ / §6.7 承認の4択 / §6.9 記録される成果物 / §6.10 品質指標
// プロンプト雛形（出力フィールドの定義元）:
//   docs/prompts/pass1-observation.md, docs/prompts/pass2-interrogation.md
//
// 注: この段階ではスキーマ（契約）の確定だけが目的。SQLite 台帳リポジトリと CLI 改修は
//     このスキーマがレビューで承認されてから着手する。

import { z } from "zod";

// ── 共通の列挙（プロンプト雛形 pass2 の定義と完全一致させること）──────────────

/** リスク種別（§6.7 リスク順の根拠 / pass2 `risk`）。 */
export const Risk = z.enum(["money", "data", "auth", "irreversible", "critical", "other"]);
export type Risk = z.infer<typeof Risk>;

/**
 * 試験の優先度（decisions/0017）。人が設定する「どれから試験するか」の序列で、
 * リスク種別（危険の category）とは別軸。既定はリスクから導出（priorityFromRisk）。
 */
export const Priority = z.enum(["high", "medium", "low"]);
export type Priority = z.infer<typeof Priority>;

/** リスク種別から優先度の既定値を導く（金/認証/不可逆/重大=高, データ=中, その他=低）。 */
export function priorityFromRisk(risk: Risk): Priority {
  if (risk === "money" || risk === "auth" || risk === "irreversible" || risk === "critical") return "high";
  if (risk === "data") return "medium";
  return "low";
}

/** 質問の種類（pass2 `kind`）。contradiction は §6.6 の矛盾スキャン由来。 */
export const Kind = z.enum(["behavior", "omission", "boundary", "contradiction", "precondition"]);
export type Kind = z.infer<typeof Kind>;

/** AI 推測の確信度（pass2 `confidence`）。low は人間向けに「要確認」として強調する。 */
export const Confidence = z.enum(["high", "med", "low"]);
export type Confidence = z.infer<typeof Confidence>;

/** 観点の主体（decisions/0007）。director=業務/画面、engineer=実装/技術。 */
export const Perspective = z.enum(["director", "engineer"]);
export type Perspective = z.infer<typeof Perspective>;

/** 観点の強度。loose=最重要だけ / medium=中間 / strong=総当たり。 */
export const Intensity = z.enum(["loose", "medium", "strong"]);
export type Intensity = z.infer<typeof Intensity>;

// ── Pass 1（観測）: 挙動インベントリ ─────────────────────────────────────────
// 出典: docs/prompts/pass1-observation.md の `<出力>`。事実のみ・評価/意図推測は含まない。

export const ObservationItem = z.object({
  /** 対象（ファイル/関数、可能なら行番号）。 */
  anchor: z.string().min(1),
  /** どんな入力・条件で起きるか。 */
  trigger: z.string().min(1),
  /** そのとき実際に起きること（事実のみ）。 */
  behavior: z.string().min(1),
  /** 副作用（DB書込 / 外部送信 / 課金 / 状態変更 / ファイルIO 等）。無ければ空配列。 */
  effects: z.array(z.string()).default([]),
});
export type ObservationItem = z.infer<typeof ObservationItem>;

/** Pass1 の出力全体（= 観測インベントリ）。 */
export const Inventory = z.array(ObservationItem);
export type Inventory = z.infer<typeof Inventory>;

// ── Pass 2（尋問）: 確認質問 ─────────────────────────────────────────────────
// 出典: docs/prompts/pass2-interrogation.md の `<出力>`。
// 鏡化（コードを読めば答えられる質問）を排除した「人間にしか答えられない」質問だけ。

export const Question = z.object({
  /** 対象（ファイル/関数/動線）。 */
  anchor: z.string().min(1),
  /** 質問文（「コードは〔観測〕。しかし〔リスク〕。意図通りか？」の型）。 */
  question: z.string().min(1),
  /** リスク種別。 */
  risk: Risk,
  /** AI が推測する正解（§6.7 人間のデフォルト選択肢にする）。 */
  assumption: z.string().min(1),
  /** 確信度。 */
  confidence: Confidence,
  /** 質問の種類。 */
  kind: Kind,
});
export type Question = z.infer<typeof Question>;

/** Pass2 の出力全体（= 確認質問リスト）。 */
export const Questions = z.array(Question);
export type Questions = z.infer<typeof Questions>;

// ── 入力コードの素性（provenance / §6.9「最終照合」の起点）─────────────────────

export const CodeRef = z.object({
  /** 入力ファイルのパス（標準入力なら null）。 */
  path: z.string().nullable().default(null),
  /** 入力コードの内容ハッシュ（どのコード版で観測したかの識別子）。 */
  contentHash: z.string().min(1),
});
export type CodeRef = z.infer<typeof CodeRef>;

// ── 承認状態（§6.7 の1タップ4択 ＋ 初期の未決）────────────────────────────────
//   pending         … 未決（初期値。AI推測がデフォルト選択として提示されている状態）
//   confirmed       … ✓意図通り        → declaredIntent = AI推測を採用
//   corrected       … ✗違う→正解:___   → declaredIntent = 人間が訂正した正解（= テスト前に見つかったバグ）
//   not_applicable  … —テスト不要
//   unknown         … ?わからない       → §6.7「最重要シグナル」。組織の誰も正解を知らない箇所
// （§6.8: corrected と unknown は、テストを1行も走らせる前に検出された欠陥）

export const ApprovalStatus = z.enum([
  "pending",
  "confirmed",
  "corrected",
  "not_applicable",
  "unknown",
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

// ── Pass 3（テスト生成）: 承認された意図 → テスト項目（§6.2⑤）────────────────────
// 出典: docs/prompts/pass3-testgen.md。コードではなく declaredIntent（人間が承認した正解）
// から、観測可能な振る舞い（E2E/受け入れ粒度・ツール非依存）のテスト項目を作る。

/** LLM が出力する部分（kind は status から engine が決めるので含めない）。 */
export const Pass3Output = z.object({
  /** テスト項目の見出し。 */
  title: z.string().min(1),
  /** 前提（ログイン状態・データ・画面 等）。 */
  given: z.string().min(1),
  /** 操作・トリガ。 */
  when: z.string().min(1),
  /** 期待される結果（= 承認された意図）。 */
  then: z.string().min(1),
  /** なぜこのテストか（どのリスク・意図に対応するか）。 */
  rationale: z.string().min(1),
});
export type Pass3Output = z.infer<typeof Pass3Output>;

/** AIが下書きするHTTPリクエスト（人が確認・修正して送信。decisions/0015）。 */
export const RequestDraft = z.object({
  method: z.string().min(1),
  url: z.string(),
  headers: z.string().default(""),
  body: z.string().default(""),
});
export type RequestDraft = z.infer<typeof RequestDraft>;

/** 正常系（観測ベース）の1項目。Pass1観測 → 回帰テスト項目の下書き（decisions/0016）。 */
export const NormalItem = z.object({
  anchor: z.string().min(1),
  title: z.string().min(1),
  given: z.string().min(1),
  when: z.string().min(1),
  then: z.string().min(1),
});
export type NormalItem = z.infer<typeof NormalItem>;

/** JSONインポートの1項目（実装者が取り込む。最低 title があればよい）。 */
export const ImportItem = z.object({
  title: z.string().min(1),
  given: z.string().default(""),
  when: z.string().default(""),
  then: z.string().default(""),
  anchor: z.string().default(""),
  kind: z.enum(["regression", "known_bug"]).default("regression"),
  risk: Risk.default("other"),
});
export type ImportItem = z.infer<typeof ImportItem>;

/** 台帳に保存するテスト項目。kind は承認状態から決まる。 */
export const TestItem = Pass3Output.extend({
  // confirmed → regression（現在の意図を固定）, corrected → known_bug（今は落ちる＝既知バグ）
  kind: z.enum(["regression", "known_bug"]),
});
export type TestItem = z.infer<typeof TestItem>;

// ── §6.9 台帳レコード（1項目 = 1レコード。「生きた仕様書」かつ「テストの生成元」）──

export const LedgerRecord = z.object({
  /** 安定ID（anchor + question から導出する想定。再観測時の突合に使う）。 */
  id: z.string().min(1),

  /** 種別（由来）。oracle=質問/normal=正常系(観測)/manual=手動/imported=JSON取込。decisions/0016。 */
  track: z.enum(["oracle", "normal", "manual", "imported"]).default("oracle"),

  /** どの実行（run）で生まれたか（由来追跡に使う。手動/取込は "manual"）。 */
  runId: z.string().min(1),

  /** 所属する課題ID（明示リンク。decisions/0012）。導出値でバックフィル済み。 */
  issueId: z.string().min(1),

  /** 生成時のレンズ（decisions/0007）。 */
  perspective: Perspective.default("engineer"),
  intensity: Intensity.default("strong"),

  /** どのコード版に対する記録か（§6.9「最終照合」の起点 / §6.4 監査）。 */
  codeRef: CodeRef,

  // —— 対象・観測（AIが見た事実。Pass1/Pass2 由来）——
  /** 対象（ファイル/関数/動線）。§6.9「対象」。 */
  anchor: z.string().min(1),
  /** 観測された実際の挙動。§6.9「観測」。Pass1 の behavior 由来（無ければ質問から補う）。 */
  observation: z.string().min(1),
  /** 人間に提示された確認質問（Pass2 由来）。承認の文脈を台帳に残す。 */
  question: z.string().min(1),

  // —— AIの推測（人間のデフォルト選択肢。Pass2 由来）——
  risk: Risk,
  /** 試験の優先度（人が設定。既定はリスクから導出。decisions/0017）。 */
  priority: Priority.default("medium"),
  kind: Kind,
  confidence: Confidence,
  /** AI が推測する正解（§6.7 デフォルト値）。 */
  aiAssumption: z.string().min(1),

  // —— 採用（キュレーション。候補→テスト項目。decisions/0008）——
  /** 人が「テスト項目として採用」したか。false=候補のまま。 */
  adopted: z.boolean().default(false),

  /** 担当者（userId・割り当て。実施者 created_by とは別。decisions/0019）。未割当は null。 */
  assignee: z.string().nullable().default(null),

  // —— 人間の承認（§6.7）——
  /** 承認状態。§6.9「状態」。 */
  status: ApprovalStatus.default("pending"),
  /**
   * 宣言した意図 = 組織で初めて文章化された「正解」。§6.9「宣言した意図」。
   * confirmed なら観測（現状の挙動が正しい）、corrected なら人間の訂正文。未決なら null。
   * （✓ の意味は decisions/0003 で §6.2 に揃えた）
   */
  declaredIntent: z.string().nullable().default(null),

  // —— 派生成果物 ⑤ ——
  /** この意図から生成したテスト項目。§6.9「生成テスト」/ ⑤。未生成なら null。 */
  generatedTest: TestItem.nullable().default(null),
  /** 最終照合: どのコード版で確認したか（contentHash 等）。§6.9「最終照合」。 */
  lastVerifiedCodeRef: z.string().nullable().default(null),

  // —— タイムスタンプ（ISO8601 文字列）——
  createdAt: z.string(),
  /** 人間が承認/訂正した時刻。未決なら null。 */
  decidedAt: z.string().nullable().default(null),
});
export type LedgerRecord = z.infer<typeof LedgerRecord>;

// ── 明示プロジェクト（一級エンティティ。decisions/0012）──────────────────────────
export const Project = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().nullable().default(null),
  /** 連携する GitHub リポジトリ（owner/repo）。課題作成時のソース既定に使う。 */
  repo: z.string().nullable().default(null),
  /**
   * 学習ナレッジ（訂正の資産化。decisions/0023）。このプロジェクトで積んだ ✗訂正 から抽出した
   * 再利用可能な教訓。配下すべての観測/尋問の <前提知識> に課題ナレッジと併せて注入する。
   */
  lessons: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type Project = z.infer<typeof Project>;

// ── 明示課題（一級エンティティ。タイトル/概要/AI分析ナレッジ・decisions/0010）──────
export const SourceKind = z.enum(["pr", "file", "local", "none"]);
export type SourceKind = z.infer<typeof SourceKind>;

export const Issue = z.object({
  /** issueId(projectKey, issueKey) と一致（導出課題と統合するため）。 */
  id: z.string().min(1),
  projectKey: z.string().min(1),
  projectLabel: z.string().min(1),
  title: z.string().min(1),
  overview: z.string().nullable().default(null),
  sourceKind: SourceKind,
  /** 観測対象（gh:owner/repo#123 / gh:owner/repo:path / ローカルパス）。none なら null。 */
  sourceRef: z.string().nullable().default(null),
  /** AI分析ナレッジ：観測/尋問プロンプトに前提知識として注入する。 */
  knowledge: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type Issue = z.infer<typeof Issue>;

// ── ユーザー（マルチユーザー・認証。decisions/0018）──────────────────────────────
/** ロール。admin=管理（最初の登録者）/ member=一般。Phase2でプロジェクト単位の権限を足す。 */
export const Role = z.enum(["admin", "member"]);
export type Role = z.infer<typeof Role>;

/** UI/セッションに渡す公開ユーザー（パスワードハッシュは含めない）。 */
export const User = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  name: z.string().min(1),
  role: Role.default("member"),
  createdAt: z.string(),
  /** 最終ログイン時刻（ISO・未ログインは null。decisions/0018）。 */
  lastSeenAt: z.string().nullable().default(null),
});
export type User = z.infer<typeof User>;

/** プロジェクト内のロール（Phase2・decisions/0018）。owner=管理可 / member=作業可 / viewer=閲覧のみ。 */
export const MemberRole = z.enum(["owner", "member", "viewer"]);
export type MemberRole = z.infer<typeof MemberRole>;

/** プロジェクトのメンバーシップ（誰がどのプロジェクトに何のロールで属するか）。 */
export const ProjectMember = z.object({
  projectKey: z.string().min(1),
  userId: z.string().min(1),
  role: MemberRole.default("member"),
  createdAt: z.string(),
});
export type ProjectMember = z.infer<typeof ProjectMember>;

// ── AI使用ログ（LLM呼び出しの記録。管理画面で使用状況を確認・decisions/0021）──────
export const AiUsageKind = z.enum([
  "observe", // Pass1 観測
  "interrogate", // Pass2 尋問
  "normal", // 正常系生成
  "testgen", // Pass3 テスト生成
  "knowledge", // AI分析ナレッジ
  "request", // HTTPリクエスト下書き
  "drift", // 意図ドリフト検査（承認済み意図 vs 新観測。decisions/0022）
  "lessons", // 訂正の資産化（✗訂正から学習ナレッジを抽出。decisions/0023）
]);
export type AiUsageKind = z.infer<typeof AiUsageKind>;

export const AiUsage = z.object({
  id: z.string().min(1),
  kind: AiUsageKind,
  model: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** 実行者（userId・CLI等は null）。 */
  userId: z.string().nullable().default(null),
  projectKey: z.string().nullable().default(null),
  issueId: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type AiUsage = z.infer<typeof AiUsage>;

// ── 意図ドリフト検出（承認済みの意図 vs 新しい観測。§6.2⑥の再確認ループ・decisions/0022）──
// 「生きた仕様」が一度承認されて終わりにならないよう、コード更新時に再観測し、
// 承認済みの意図（declaredIntent）と矛盾する新挙動＝ドリフトを検出する。判定は人間（正/回帰）。

/** ドリフトの深刻度（表示の並び・強調に使う）。 */
export const DriftSeverity = z.enum(["high", "med", "low"]);
export type DriftSeverity = z.infer<typeof DriftSeverity>;

/** ドリフト検査プロンプトの出力1件（LLM由来。どの承認済み意図と矛盾するか）。 */
export const DriftOutput = z.object({
  /** 矛盾する承認済みレコードのID（specs で渡した recordId のいずれか）。 */
  specRecordId: z.string().min(1),
  /** 対象（ファイル/関数/動線）。 */
  anchor: z.string().min(1),
  /** 新しい観測（現在のコードが実際にすること・事実のみ）。 */
  newObservation: z.string().min(1),
  /** なぜ承認済みの意図と矛盾するか（人が正/回帰を判断する材料）。 */
  contradiction: z.string().min(1),
  severity: DriftSeverity,
});
export type DriftOutput = z.infer<typeof DriftOutput>;

/** 検査状態。open=未対応 / dismissed=無視 / resolved=対応済み（意図を更新した等）。 */
export const DriftStatus = z.enum(["open", "dismissed", "resolved"]);
export type DriftStatus = z.infer<typeof DriftStatus>;

/** 台帳に保存するドリフト検出（承認済み意図と新観測のスナップショット付き）。 */
export const DriftFinding = z.object({
  id: z.string().min(1),
  issueId: z.string().min(1),
  /** 矛盾した承認済みレコード（= 生きた仕様の1項目）のID。 */
  specRecordId: z.string().min(1),
  anchor: z.string().min(1),
  /** 検査時点の承認済み意図（後で意図が変わっても検査文脈を残す）。 */
  approvedIntent: z.string().min(1),
  newObservation: z.string().min(1),
  contradiction: z.string().min(1),
  severity: DriftSeverity,
  /** どのコード版で検出したか（contentHash）。 */
  codeHash: z.string().min(1),
  status: DriftStatus.default("open"),
  createdAt: z.string(),
});
export type DriftFinding = z.infer<typeof DriftFinding>;

// ── 証跡（手動テストのスクショ等。まずローカル保存・decisions/0006）──────────────
export const Evidence = z.object({
  id: z.string().min(1),
  recordId: z.string().min(1),
  filename: z.string().min(1),
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
  note: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type Evidence = z.infer<typeof Evidence>;

// ── 実行結果（手動テストの単件結果。pass/fail/blocked を履歴で。decisions/0009）──────
export const ResultStatus = z.enum(["pass", "fail", "blocked"]);
export type ResultStatus = z.infer<typeof ResultStatus>;

export const Result = z.object({
  id: z.string().min(1),
  recordId: z.string().min(1),
  status: ResultStatus,
  note: z.string().nullable().default(null),
  /** 実施日（YYYY-MM-DD 等）。 */
  executedAt: z.string().min(1),
  /** 記録された時刻（並び順に使う）。 */
  createdAt: z.string(),
  /** 実施者のユーザーID（記名・decisions/0018）。旧データは null。 */
  createdBy: z.string().nullable().default(null),
});
export type Result = z.infer<typeof Result>;

// ── 項目に紐づくHTTPリクエスト（手動コンソール。人が送り人が判定。decisions/0014）──
export const HttpRequest = z.object({
  recordId: z.string().min(1),
  method: z.string().min(1),
  url: z.string(),
  /** ヘッダ（"Key: Value" を改行区切り）。 */
  headers: z.string().nullable().default(null),
  body: z.string().nullable().default(null),
  /** 直近の送信結果。 */
  lastStatus: z.number().int().nullable().default(null),
  lastMs: z.number().int().nullable().default(null),
  lastResponse: z.string().nullable().default(null),
  updatedAt: z.string(),
});
export type HttpRequest = z.infer<typeof HttpRequest>;

// ── 1回のパイプライン実行（§6.4 監査単位 / SQLite 化の際のルート）──────────────
// 観測が監査可能であること（§6.4）のため、実行ごとに入力素性・モデル・両パスの生出力を束ねる。

export const AuditRun = z.object({
  id: z.string().min(1),
  /** 所属する課題ID（明示リンク。decisions/0012）。 */
  issueId: z.string().min(1),
  codeRef: CodeRef,
  /** 使用したモデルID（記憶でなく docs.claude.com で確認したもの）。 */
  model: z.string().min(1),
  perspective: Perspective.default("engineer"),
  intensity: Intensity.default("strong"),
  createdAt: z.string(),
  inventory: Inventory,
  questions: Questions,
});
export type AuditRun = z.infer<typeof AuditRun>;
