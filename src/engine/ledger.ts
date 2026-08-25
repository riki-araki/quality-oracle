// src/engine/ledger.ts
// §6.9「生きた仕様」台帳のリポジトリ。リポジトリ抽象（LedgerRepository）の背後に
// ローカル SQLite 実装を置く。将来のホスト化では同じインターフェースのまま
// PostgreSQL 実装に差し替える（decisions/0002）。

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
// node:sqlite は実験的機能のため import 時に stderr へ ExperimentalWarning を出すが無害。
// stdout（質問JSON等）は汚れない。将来 better-sqlite3 / PostgreSQL 実装に差し替え可能。
import { DatabaseSync } from "node:sqlite";
import { LedgerRecord, ApprovalStatus } from "./schema";
import { Evidence, Result, Issue, Project, HttpRequest, User, ProjectMember, AiUsage, DriftFinding } from "./schema";
import type { AuditRun, Risk, Kind, Confidence, TestItem, ResultStatus, SourceKind, Role, MemberRole, DriftStatus } from "./schema";
import { recordId } from "./ids";
import { priorityFromRisk } from "./schema";
import { deriveFromPath, issueId as deriveIssueId } from "./issues";

export interface ListFilter {
  runId?: string;
  issueId?: string;
  status?: ApprovalStatus;
  risk?: Risk;
  adopted?: boolean;
}

export interface LedgerMetrics {
  total: number;
  decided: number; // pending 以外
  byStatus: Record<string, number>;
  byRisk: Record<string, number>;
  byKind: Record<string, number>;
  /** §6.10③ テスト前バグ検出率の近似: corrected / decided。価値の直接指標。 */
  correctedRate: number;
  /** §6.7「最重要シグナル」: unknown / decided。誰も正解を知らない箇所の割合。 */
  unknownRate: number;
}

export interface RunSummary {
  id: string;
  codePath: string | null;
  model: string;
  createdAt: string;
}

export interface LedgerRepository {
  saveRun(run: AuditRun): void;
  /** 最新の実行ID（承認画面の既定表示対象）。無ければ null。 */
  latestRunId(): string | null;
  /** 実行の一覧（新しい順）。 */
  listRuns(): RunSummary[];
  /** 質問から pending レコードを生成（既存は保持＝再観測で承認を失わない §6.2⑥）。 */
  seedRecords(run: AuditRun): LedgerRecord[];
  listRecords(filter?: ListFilter): LedgerRecord[];
  getRecord(id: string): LedgerRecord | null;
  /** 人間の4択を適用（§6.7）。corrected は intent 必須。承認変更で既存テストは無効化。 */
  setDecision(id: string, status: ApprovalStatus, intent?: string | null): LedgerRecord;
  /** テスト項目として採用/解除（候補→項目。decisions/0008）。 */
  setAdopted(id: string, adopted: boolean): LedgerRecord;
  /** 意図を上書きし confirmed に戻す（ドリフト対応で新挙動を正とする。テストは無効化して再生成。decisions/0022）。 */
  updateIntent(id: string, intent: string): LedgerRecord;
  /** 試験の優先度を設定（人が「どれから試験するか」を決める。decisions/0017）。 */
  setPriority(id: string, priority: LedgerRecord["priority"]): LedgerRecord;
  /** 担当者を設定/解除（userId か null。decisions/0019）。 */
  setAssignee(id: string, assignee: string | null): LedgerRecord;
  /** 候補を捨てる（不採用。レコードと紐づく証跡メタを削除）。 */
  deleteRecord(id: string): void;
  /** 完全な record を挿入（正常系/手動/取込。既存IDは無視）。decisions/0016。 */
  addRecord(rec: LedgerRecord): void;
  /** ⑤ 生成したテスト項目を保存。 */
  setGeneratedTest(id: string, test: TestItem): LedgerRecord;
  metrics(runId?: string): LedgerMetrics;

  // —— 証跡（decisions/0006。ファイル実体はアプリ層、メタはここ）——
  addEvidence(row: EvidenceRow): void;
  listEvidence(recordId: string): Evidence[];
  /** 配信/削除用にファイルパス込みで取得。 */
  getEvidenceFile(id: string): EvidenceFile | null;
  /** 証跡が属するレコードID（アクセス制御の判定に使う）。 */
  getEvidenceRecordId(id: string): string | null;
  deleteEvidence(id: string): void;
  /** 指定レコード群の証跡件数（テーブル表示用）。 */
  evidenceCounts(recordIds: string[]): Record<string, number>;

  // —— 実行結果（手動テストの単件結果。decisions/0009）——
  addResult(row: Result): void;
  listResults(recordId: string): Result[];
  /** 指定レコード群の最新結果（管理テーブル表示用。記録なしは未収録）。 */
  latestResults(recordIds: string[]): Record<string, ResultStatus>;
  /** 最新結果を詳細込みで（状態・実施日・実施者）。一覧の表示用。 */
  latestResultMeta(recordIds: string[]): Record<string, { status: ResultStatus; executedAt: string; createdBy: string | null }>;
  deleteResult(id: string): void;

  // —— 明示課題（issue_meta。decisions/0010）——
  listIssues(): Issue[];
  getIssue(id: string): Issue | null;
  /** タイトル/概要/ソースを upsert（knowledge は保持）。 */
  upsertIssue(issue: Omit<Issue, "knowledge">): void;
  setIssueKnowledge(id: string, knowledge: string | null): void;

  // —— 明示プロジェクト（project_meta。decisions/0012）——
  listProjects(): Project[];
  getProject(key: string): Project | null;
  /** 名前/説明/リポジトリを upsert（lessons は触らず保持）。 */
  upsertProject(project: Omit<Project, "lessons">): void;
  /** 学習ナレッジ（訂正の資産化）を設定/解除。upsertProject では触らず保持。decisions/0023。 */
  setProjectLessons(key: string, lessons: string | null): void;

  // —— ユーザー（認証・マルチユーザー。decisions/0018）——
  createUser(u: NewUser): void;
  /** 認証用にパスワードハッシュ込みで取得（email は小文字前提）。 */
  getUserAuth(email: string): AuthUser | null;
  getUser(id: string): User | null;
  getUserByEmail(email: string): User | null;
  listUsers(): User[];
  countUsers(): number;
  /** 最終ログイン時刻を更新（ログイン時に呼ぶ）。 */
  touchUser(id: string): void;

  // —— AI使用ログ（decisions/0021）——
  addAiUsage(row: AiUsage): void;
  listAiUsage(): AiUsage[];

  // —— 意図ドリフト検出（decisions/0022）——
  addDriftFinding(row: DriftFinding): void;
  listDriftFindings(issueId: string, status?: DriftStatus): DriftFinding[];
  setDriftStatus(id: string, status: DriftStatus): void;
  /** 課題の open な検出を消す（再検査の前に古い結果を掃く。dismissed/resolved は残す）。 */
  clearOpenDriftFindings(issueId: string): void;
  /** ドリフト検出が属する課題ID（アクセス制御の判定に使う）。 */
  getDriftIssueId(id: string): string | null;

  // —— プロジェクトのメンバーシップ（データ分離・権限。decisions/0018 Phase2）——
  addMember(projectKey: string, userId: string, role: MemberRole): void;
  setMemberRole(projectKey: string, userId: string, role: MemberRole): void;
  removeMember(projectKey: string, userId: string): void;
  /** ユーザーのそのプロジェクトでのロール（未所属は null）。 */
  getMemberRole(projectKey: string, userId: string): MemberRole | null;
  listMembers(projectKey: string): ProjectMember[];
  /** ユーザーが所属する全プロジェクトキー（読み取り分離に使う）。 */
  listMemberProjectKeys(userId: string): string[];

  // —— 項目のHTTPリクエスト（手動コンソール。decisions/0014）——
  getRequest(recordId: string): HttpRequest | null;
  /** メソッド/URL/ヘッダ/ボディを upsert（直近結果は保持）。 */
  saveRequest(recordId: string, req: { method: string; url: string; headers: string | null; body: string | null }): void;
  setRequestResponse(recordId: string, status: number, ms: number, response: string): void;

  close(): void;
}

export interface NewUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
}
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
}

export interface EvidenceRow extends Evidence {
  storedPath: string;
}
export interface EvidenceFile {
  storedPath: string;
  mime: string;
  filename: string;
}

type Row = Record<string, string | number | null>;

function rowToRecord(r: Row): LedgerRecord {
  return LedgerRecord.parse({
    id: r.id,
    track: r.track,
    runId: r.run_id,
    issueId: r.issue_id,
    perspective: r.perspective,
    intensity: r.intensity,
    adopted: r.adopted === 1,
    assignee: r.assignee ?? null,
    codeRef: { path: r.code_path, contentHash: r.code_hash },
    anchor: r.anchor,
    observation: r.observation,
    question: r.question,
    risk: r.risk,
    priority: r.priority ?? "medium",
    kind: r.kind,
    confidence: r.confidence,
    aiAssumption: r.ai_assumption,
    status: r.status,
    declaredIntent: r.declared_intent,
    generatedTest: r.generated_test ? JSON.parse(r.generated_test as string) : null,
    lastVerifiedCodeRef: r.last_verified_code_ref,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
  });
}

export class SqliteLedger implements LedgerRepository {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL DEFAULT '',
        code_path TEXT,
        code_hash TEXT NOT NULL,
        model TEXT NOT NULL,
        perspective TEXT NOT NULL DEFAULT 'engineer',
        intensity TEXT NOT NULL DEFAULT 'strong',
        created_at TEXT NOT NULL,
        inventory_json TEXT NOT NULL,
        questions_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        issue_id TEXT NOT NULL DEFAULT '',
        track TEXT NOT NULL DEFAULT 'oracle',
        code_path TEXT,
        code_hash TEXT NOT NULL,
        anchor TEXT NOT NULL,
        observation TEXT NOT NULL,
        question TEXT NOT NULL,
        risk TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'medium',
        kind TEXT NOT NULL,
        confidence TEXT NOT NULL,
        perspective TEXT NOT NULL DEFAULT 'engineer',
        intensity TEXT NOT NULL DEFAULT 'strong',
        adopted INTEGER NOT NULL DEFAULT 0,
        assignee TEXT,
        ai_assumption TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        declared_intent TEXT,
        generated_test TEXT,
        last_verified_code_ref TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_records_run ON records(run_id);
      CREATE INDEX IF NOT EXISTS idx_records_status ON records(status);
      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        stored_path TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_evidence_record ON evidence(record_id);
      CREATE TABLE IF NOT EXISTS results (
        id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        status TEXT NOT NULL,
        note TEXT,
        executed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_results_record ON results(record_id);
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT
      );
      CREATE TABLE IF NOT EXISTS project_members (
        project_key TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_key, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_members_user ON project_members(user_id);
      CREATE TABLE IF NOT EXISTS ai_usage (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        user_id TEXT,
        project_key TEXT,
        issue_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at);
      CREATE TABLE IF NOT EXISTS drift_findings (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL,
        spec_record_id TEXT NOT NULL,
        anchor TEXT NOT NULL,
        approved_intent TEXT NOT NULL,
        new_observation TEXT NOT NULL,
        contradiction TEXT NOT NULL,
        severity TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_drift_issue ON drift_findings(issue_id);
      CREATE TABLE IF NOT EXISTS issue_meta (
        id TEXT PRIMARY KEY,
        project_key TEXT NOT NULL,
        project_label TEXT NOT NULL,
        title TEXT NOT NULL,
        overview TEXT,
        source_kind TEXT NOT NULL,
        source_ref TEXT,
        knowledge TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_meta (
        key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        description TEXT,
        repo TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS item_request (
        record_id TEXT PRIMARY KEY,
        method TEXT NOT NULL,
        url TEXT NOT NULL,
        headers TEXT,
        body TEXT,
        last_status INTEGER,
        last_ms INTEGER,
        last_response TEXT,
        updated_at TEXT NOT NULL
      );
    `);
    this.migrate();
    this.backfillIssueIds();
    this.backfillProjectOwners();
  }

  // 既存DBへ後付け列を足す（重複時は無視）。decisions/0007 のレンズ列など。
  private migrate(): void {
    const alters = [
      "ALTER TABLE runs ADD COLUMN perspective TEXT NOT NULL DEFAULT 'engineer'",
      "ALTER TABLE runs ADD COLUMN intensity TEXT NOT NULL DEFAULT 'strong'",
      "ALTER TABLE records ADD COLUMN perspective TEXT NOT NULL DEFAULT 'engineer'",
      "ALTER TABLE records ADD COLUMN intensity TEXT NOT NULL DEFAULT 'strong'",
      "ALTER TABLE records ADD COLUMN adopted INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE runs ADD COLUMN issue_id TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE records ADD COLUMN issue_id TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE project_meta ADD COLUMN repo TEXT",
      "ALTER TABLE records ADD COLUMN track TEXT NOT NULL DEFAULT 'oracle'",
      "ALTER TABLE results ADD COLUMN created_by TEXT",
      "ALTER TABLE records ADD COLUMN assignee TEXT",
      "ALTER TABLE users ADD COLUMN last_seen_at TEXT",
      "ALTER TABLE project_meta ADD COLUMN lessons TEXT",
    ];
    for (const sql of alters) {
      try {
        this.db.exec(sql);
      } catch {
        /* 既に列がある場合は無視 */
      }
    }
    // priority: 列を新規追加した時だけ risk から一括バックフィル（人の編集を後で壊さない）。
    // decisions/0017。ALTER が成功＝新規列。既存（列がある）なら catch して何もしない。
    try {
      this.db.exec("ALTER TABLE records ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'");
      this.db.exec(`UPDATE records SET priority = CASE
        WHEN risk IN ('money','auth','irreversible','critical') THEN 'high'
        WHEN risk = 'data' THEN 'medium'
        ELSE 'low' END`);
    } catch {
      /* 既に priority 列がある＝バックフィル済み。人が編集した値を保持する。 */
    }
  }

  // issue_id 未設定の既存行を codeRef から導出してバックフィル（非破壊・冪等）。decisions/0012。
  private backfillIssueIds(): void {
    const fill = (table: string) => {
      const rows = this.db
        .prepare(`SELECT id, code_path FROM ${table} WHERE issue_id IS NULL OR issue_id = ''`)
        .all() as Row[];
      if (rows.length === 0) return;
      const upd = this.db.prepare(`UPDATE ${table} SET issue_id = ? WHERE id = ?`);
      for (const r of rows) {
        const d = deriveFromPath((r.code_path as string | null) ?? null);
        upd.run(deriveIssueId(d.projectKey, d.issueKey), r.id as string);
      }
    };
    try {
      fill("runs");
      fill("records");
    } catch {
      /* 列がまだ無い等は無視 */
    }
  }

  // 既存プロジェクト（メンバー未設定）を最初の admin の所有にする（decisions/0018 Phase2・要件1）。
  // メンバーが1人でもいるプロジェクトは触らない（冪等・非破壊）。admin 不在なら何もしない。
  private backfillProjectOwners(): void {
    try {
      const admin = this.db
        .prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)
        .get() as { id: string } | undefined;
      if (!admin) return;

      // 既存の全プロジェクトキーを列挙（明示project_meta ＋ issue_meta ＋ records由来）。
      const keys = new Set<string>();
      for (const r of this.db.prepare(`SELECT key FROM project_meta`).all() as Row[]) keys.add(r.key as string);
      for (const r of this.db.prepare(`SELECT DISTINCT project_key FROM issue_meta`).all() as Row[]) {
        if (r.project_key) keys.add(r.project_key as string);
      }
      for (const r of this.db.prepare(`SELECT DISTINCT code_path FROM records`).all() as Row[]) {
        keys.add(deriveFromPath((r.code_path as string | null) ?? null).projectKey);
      }

      const hasMember = this.db.prepare(`SELECT 1 FROM project_members WHERE project_key = ? LIMIT 1`);
      const insert = this.db.prepare(
        `INSERT OR IGNORE INTO project_members (project_key, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`
      );
      const now = new Date().toISOString();
      for (const key of keys) {
        if (hasMember.get(key)) continue; // 既にメンバーがいるなら触らない
        insert.run(key, admin.id, now);
      }
    } catch {
      /* users / project_members がまだ無い等は無視 */
    }
  }

  saveRun(run: AuditRun): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO runs
         (id, issue_id, code_path, code_hash, model, perspective, intensity, created_at, inventory_json, questions_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        run.issueId,
        run.codeRef.path,
        run.codeRef.contentHash,
        run.model,
        run.perspective,
        run.intensity,
        run.createdAt,
        JSON.stringify(run.inventory),
        JSON.stringify(run.questions)
      );
  }

  latestRunId(): string | null {
    const row = this.db
      .prepare(`SELECT id FROM runs ORDER BY created_at DESC LIMIT 1`)
      .get() as { id: string } | undefined;
    return row ? row.id : null;
  }

  listRuns(): RunSummary[] {
    const rows = this.db
      .prepare(`SELECT id, code_path, model, created_at FROM runs ORDER BY created_at DESC`)
      .all() as Row[];
    return rows.map((r) => ({
      id: r.id as string,
      codePath: (r.code_path as string | null) ?? null,
      model: r.model as string,
      createdAt: r.created_at as string,
    }));
  }

  seedRecords(run: AuditRun): LedgerRecord[] {
    // 質問 anchor に一致する観測 behavior を §6.9「観測」に充てる。無ければ質問文で代替。
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO records
       (id, run_id, issue_id, code_path, code_hash, anchor, observation, question,
        risk, priority, kind, confidence, perspective, intensity, ai_assumption, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    );
    for (const q of run.questions) {
      const match = run.inventory.find((it) => it.anchor === q.anchor);
      const observation = match ? match.behavior : q.question;
      insert.run(
        recordId(q.anchor, q.question),
        run.id,
        run.issueId,
        run.codeRef.path,
        run.codeRef.contentHash,
        q.anchor,
        observation,
        q.question,
        q.risk,
        priorityFromRisk(q.risk),
        q.kind,
        q.confidence,
        run.perspective,
        run.intensity,
        q.assumption,
        run.createdAt
      );
    }
    return this.listRecords({ runId: run.id });
  }

  listRecords(filter: ListFilter = {}): LedgerRecord[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.runId) (where.push("run_id = ?"), params.push(filter.runId));
    if (filter.issueId) (where.push("issue_id = ?"), params.push(filter.issueId));
    if (filter.status) (where.push("status = ?"), params.push(filter.status));
    if (filter.risk) (where.push("risk = ?"), params.push(filter.risk));
    if (filter.adopted !== undefined) (where.push("adopted = ?"), params.push(filter.adopted ? 1 : 0));
    const sql =
      `SELECT * FROM records` +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      // 未決を上に → 優先度(高>中>低) → リスク順（§6.7）: 金 > 不可逆 > 認証 > データ > 重要 > その他。
      ` ORDER BY
         CASE status WHEN 'pending' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END,
         CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
         CASE risk WHEN 'money' THEN 0 WHEN 'irreversible' THEN 1 WHEN 'auth' THEN 2
                   WHEN 'data' THEN 3 WHEN 'critical' THEN 4 ELSE 5 END,
         created_at`;
    return (this.db.prepare(sql).all(...params) as Row[]).map(rowToRecord);
  }

  getRecord(id: string): LedgerRecord | null {
    const row = this.db.prepare(`SELECT * FROM records WHERE id = ?`).get(id) as Row | undefined;
    return row ? rowToRecord(row) : null;
  }

  setDecision(id: string, status: ApprovalStatus, intent?: string | null): LedgerRecord {
    const current = this.getRecord(id);
    if (!current) throw new Error(`レコードが見つからない: ${id}`);

    let declaredIntent: string | null;
    switch (status) {
      case "confirmed":
        // ✓意図通り = 現状の観測が正しい（§6.2: 今ので正しい → 回帰テスト）。
        // declaredIntent は観測そのもの。intent 引数は無視する（訂正は corrected の役割）。
        declaredIntent = current.observation;
        break;
      case "corrected":
        // ✗違う→正解: 訂正文が必須（= テスト前に見つかったバグ §6.8）。
        if (!intent || !intent.trim()) {
          throw new Error("status=corrected には --intent（正しい意図）が必須です。");
        }
        declaredIntent = intent;
        break;
      case "not_applicable":
      case "unknown":
      case "pending":
        declaredIntent = null;
        break;
      default:
        throw new Error(`未知の status: ${status}`);
    }
    const decidedAt = status === "pending" ? null : new Date().toISOString();

    // 承認内容が変わると既存の生成テストは前提が崩れるため無効化（再生成させる）。
    this.db
      .prepare(
        `UPDATE records SET status = ?, declared_intent = ?, decided_at = ?, generated_test = NULL WHERE id = ?`
      )
      .run(status, declaredIntent, decidedAt, id);
    return this.getRecord(id)!;
  }

  setAdopted(id: string, adopted: boolean): LedgerRecord {
    const current = this.getRecord(id);
    if (!current) throw new Error(`レコードが見つからない: ${id}`);
    this.db.prepare(`UPDATE records SET adopted = ? WHERE id = ?`).run(adopted ? 1 : 0, id);
    return this.getRecord(id)!;
  }

  updateIntent(id: string, intent: string): LedgerRecord {
    const current = this.getRecord(id);
    if (!current) throw new Error(`レコードが見つからない: ${id}`);
    if (!intent.trim()) throw new Error("意図が空です。");
    // 新しい挙動を「正しい意図」として承認し直す。前提が変わるので既存テストは無効化（再生成させる）。
    this.db
      .prepare(
        `UPDATE records SET declared_intent = ?, observation = ?, status = 'confirmed', decided_at = ?, generated_test = NULL WHERE id = ?`
      )
      .run(intent, intent, new Date().toISOString(), id);
    return this.getRecord(id)!;
  }

  setPriority(id: string, priority: LedgerRecord["priority"]): LedgerRecord {
    const current = this.getRecord(id);
    if (!current) throw new Error(`レコードが見つからない: ${id}`);
    this.db.prepare(`UPDATE records SET priority = ? WHERE id = ?`).run(priority, id);
    return this.getRecord(id)!;
  }

  setAssignee(id: string, assignee: string | null): LedgerRecord {
    const current = this.getRecord(id);
    if (!current) throw new Error(`レコードが見つからない: ${id}`);
    this.db.prepare(`UPDATE records SET assignee = ? WHERE id = ?`).run(assignee, id);
    return this.getRecord(id)!;
  }

  deleteRecord(id: string): void {
    this.db.prepare(`DELETE FROM evidence WHERE record_id = ?`).run(id);
    this.db.prepare(`DELETE FROM records WHERE id = ?`).run(id);
  }

  addRecord(rec: LedgerRecord): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO records
         (id, run_id, issue_id, track, code_path, code_hash, anchor, observation, question,
          risk, priority, kind, confidence, perspective, intensity, adopted, assignee, ai_assumption, status,
          declared_intent, generated_test, last_verified_code_ref, created_at, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        rec.id,
        rec.runId,
        rec.issueId,
        rec.track,
        rec.codeRef.path,
        rec.codeRef.contentHash,
        rec.anchor,
        rec.observation,
        rec.question,
        rec.risk,
        rec.priority,
        rec.kind,
        rec.confidence,
        rec.perspective,
        rec.intensity,
        rec.adopted ? 1 : 0,
        rec.assignee,
        rec.aiAssumption,
        rec.status,
        rec.declaredIntent,
        rec.generatedTest ? JSON.stringify(rec.generatedTest) : null,
        rec.lastVerifiedCodeRef,
        rec.createdAt,
        rec.decidedAt
      );
  }

  setGeneratedTest(id: string, test: TestItem): LedgerRecord {
    const current = this.getRecord(id);
    if (!current) throw new Error(`レコードが見つからない: ${id}`);
    this.db
      .prepare(`UPDATE records SET generated_test = ? WHERE id = ?`)
      .run(JSON.stringify(test), id);
    return this.getRecord(id)!;
  }

  metrics(runId?: string): LedgerMetrics {
    const records = this.listRecords(runId ? { runId } : {});
    const byStatus: Record<string, number> = {};
    const byRisk: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    for (const r of records) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      byRisk[r.risk] = (byRisk[r.risk] ?? 0) + 1;
      byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    }
    const total = records.length;
    const decided = total - (byStatus["pending"] ?? 0);
    const ratio = (n: number) => (decided === 0 ? 0 : Number((n / decided).toFixed(3)));
    return {
      total,
      decided,
      byStatus,
      byRisk,
      byKind,
      correctedRate: ratio(byStatus["corrected"] ?? 0),
      unknownRate: ratio(byStatus["unknown"] ?? 0),
    };
  }

  addEvidence(row: EvidenceRow): void {
    this.db
      .prepare(
        `INSERT INTO evidence (id, record_id, filename, mime, size, stored_path, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(row.id, row.recordId, row.filename, row.mime, row.size, row.storedPath, row.note, row.createdAt);
  }

  listEvidence(recordId: string): Evidence[] {
    const rows = this.db
      .prepare(`SELECT * FROM evidence WHERE record_id = ? ORDER BY created_at DESC`)
      .all(recordId) as Row[];
    return rows.map((r) =>
      Evidence.parse({
        id: r.id,
        recordId: r.record_id,
        filename: r.filename,
        mime: r.mime,
        size: r.size,
        note: r.note,
        createdAt: r.created_at,
      })
    );
  }

  getEvidenceFile(id: string): EvidenceFile | null {
    const r = this.db
      .prepare(`SELECT stored_path, mime, filename FROM evidence WHERE id = ?`)
      .get(id) as Row | undefined;
    if (!r) return null;
    return { storedPath: r.stored_path as string, mime: r.mime as string, filename: r.filename as string };
  }

  getEvidenceRecordId(id: string): string | null {
    const r = this.db.prepare(`SELECT record_id FROM evidence WHERE id = ?`).get(id) as Row | undefined;
    return r ? (r.record_id as string) : null;
  }

  deleteEvidence(id: string): void {
    this.db.prepare(`DELETE FROM evidence WHERE id = ?`).run(id);
  }

  evidenceCounts(recordIds: string[]): Record<string, number> {
    const out: Record<string, number> = {};
    if (recordIds.length === 0) return out;
    const placeholders = recordIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT record_id, COUNT(*) AS n FROM evidence WHERE record_id IN (${placeholders}) GROUP BY record_id`
      )
      .all(...recordIds) as Row[];
    for (const r of rows) out[r.record_id as string] = r.n as number;
    return out;
  }

  addResult(row: Result): void {
    this.db
      .prepare(
        `INSERT INTO results (id, record_id, status, note, executed_at, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(row.id, row.recordId, row.status, row.note, row.executedAt, row.createdAt, row.createdBy);
  }

  listResults(recordId: string): Result[] {
    const rows = this.db
      .prepare(`SELECT * FROM results WHERE record_id = ? ORDER BY created_at DESC`)
      .all(recordId) as Row[];
    return rows.map((r) =>
      Result.parse({
        id: r.id,
        recordId: r.record_id,
        status: r.status,
        note: r.note,
        executedAt: r.executed_at,
        createdAt: r.created_at,
        createdBy: r.created_by ?? null,
      })
    );
  }

  latestResults(recordIds: string[]): Record<string, ResultStatus> {
    const out: Record<string, ResultStatus> = {};
    if (recordIds.length === 0) return out;
    const placeholders = recordIds.map(() => "?").join(",");
    // created_at 降順で見て、各 record の最初（=最新）だけ採用。
    const rows = this.db
      .prepare(
        `SELECT record_id, status FROM results WHERE record_id IN (${placeholders}) ORDER BY created_at DESC`
      )
      .all(...recordIds) as Row[];
    for (const r of rows) {
      const rid = r.record_id as string;
      if (!(rid in out)) out[rid] = r.status as ResultStatus;
    }
    return out;
  }

  latestResultMeta(
    recordIds: string[]
  ): Record<string, { status: ResultStatus; executedAt: string; createdBy: string | null }> {
    const out: Record<string, { status: ResultStatus; executedAt: string; createdBy: string | null }> = {};
    if (recordIds.length === 0) return out;
    const placeholders = recordIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT record_id, status, executed_at, created_by FROM results
         WHERE record_id IN (${placeholders}) ORDER BY created_at DESC`
      )
      .all(...recordIds) as Row[];
    for (const r of rows) {
      const rid = r.record_id as string;
      if (!(rid in out)) {
        out[rid] = {
          status: r.status as ResultStatus,
          executedAt: r.executed_at as string,
          createdBy: (r.created_by as string | null) ?? null,
        };
      }
    }
    return out;
  }

  deleteResult(id: string): void {
    this.db.prepare(`DELETE FROM results WHERE id = ?`).run(id);
  }

  private rowToIssue(r: Row): Issue {
    return Issue.parse({
      id: r.id,
      projectKey: r.project_key,
      projectLabel: r.project_label,
      title: r.title,
      overview: r.overview,
      sourceKind: r.source_kind,
      sourceRef: r.source_ref,
      knowledge: r.knowledge,
      createdAt: r.created_at,
    });
  }

  listIssues(): Issue[] {
    return (this.db.prepare(`SELECT * FROM issue_meta`).all() as Row[]).map((r) => this.rowToIssue(r));
  }

  getIssue(id: string): Issue | null {
    const r = this.db.prepare(`SELECT * FROM issue_meta WHERE id = ?`).get(id) as Row | undefined;
    return r ? this.rowToIssue(r) : null;
  }

  upsertIssue(issue: Omit<Issue, "knowledge">): void {
    // 既存なら title/overview/source/project を更新（knowledge は保持）。無ければ作成。
    this.db
      .prepare(
        `INSERT INTO issue_meta (id, project_key, project_label, title, overview, source_kind, source_ref, knowledge, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
         ON CONFLICT(id) DO UPDATE SET
           project_key=excluded.project_key, project_label=excluded.project_label,
           title=excluded.title, overview=excluded.overview,
           source_kind=excluded.source_kind, source_ref=excluded.source_ref`
      )
      .run(
        issue.id,
        issue.projectKey,
        issue.projectLabel,
        issue.title,
        issue.overview,
        issue.sourceKind,
        issue.sourceRef,
        issue.createdAt
      );
  }

  setIssueKnowledge(id: string, knowledge: string | null): void {
    this.db.prepare(`UPDATE issue_meta SET knowledge = ? WHERE id = ?`).run(knowledge, id);
  }

  private rowToProject(r: Row): Project {
    return Project.parse({
      key: r.key,
      label: r.label,
      description: r.description,
      repo: r.repo,
      lessons: r.lessons ?? null,
      createdAt: r.created_at,
    });
  }

  listProjects(): Project[] {
    return (this.db.prepare(`SELECT * FROM project_meta`).all() as Row[]).map((r) => this.rowToProject(r));
  }

  getProject(key: string): Project | null {
    const r = this.db.prepare(`SELECT * FROM project_meta WHERE key = ?`).get(key) as Row | undefined;
    return r ? this.rowToProject(r) : null;
  }

  upsertProject(p: Omit<Project, "lessons">): void {
    this.db
      .prepare(
        `INSERT INTO project_meta (key, label, description, repo, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET label=excluded.label, description=excluded.description, repo=excluded.repo`
      )
      .run(p.key, p.label, p.description, p.repo, p.createdAt);
  }

  setProjectLessons(key: string, lessons: string | null): void {
    this.db.prepare(`UPDATE project_meta SET lessons = ? WHERE key = ?`).run(lessons, key);
  }

  createUser(u: NewUser): void {
    this.db
      .prepare(
        `INSERT INTO users (id, email, name, role, password_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(u.id, u.email, u.name, u.role, u.passwordHash, new Date().toISOString());
  }

  getUserAuth(email: string): AuthUser | null {
    const r = this.db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as Row | undefined;
    if (!r) return null;
    return {
      id: r.id as string,
      email: r.email as string,
      name: r.name as string,
      role: r.role as Role,
      passwordHash: r.password_hash as string,
    };
  }

  getUser(id: string): User | null {
    const r = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as Row | undefined;
    if (!r) return null;
    return User.parse({ id: r.id, email: r.email, name: r.name, role: r.role, createdAt: r.created_at, lastSeenAt: r.last_seen_at ?? null });
  }

  getUserByEmail(email: string): User | null {
    const r = this.db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as Row | undefined;
    if (!r) return null;
    return User.parse({ id: r.id, email: r.email, name: r.name, role: r.role, createdAt: r.created_at, lastSeenAt: r.last_seen_at ?? null });
  }

  addMember(projectKey: string, userId: string, role: MemberRole): void {
    this.db
      .prepare(
        `INSERT INTO project_members (project_key, user_id, role, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(project_key, user_id) DO UPDATE SET role = excluded.role`
      )
      .run(projectKey, userId, role, new Date().toISOString());
  }

  setMemberRole(projectKey: string, userId: string, role: MemberRole): void {
    this.db
      .prepare(`UPDATE project_members SET role = ? WHERE project_key = ? AND user_id = ?`)
      .run(role, projectKey, userId);
  }

  removeMember(projectKey: string, userId: string): void {
    this.db.prepare(`DELETE FROM project_members WHERE project_key = ? AND user_id = ?`).run(projectKey, userId);
  }

  getMemberRole(projectKey: string, userId: string): MemberRole | null {
    const r = this.db
      .prepare(`SELECT role FROM project_members WHERE project_key = ? AND user_id = ?`)
      .get(projectKey, userId) as Row | undefined;
    return r ? (r.role as MemberRole) : null;
  }

  listMembers(projectKey: string): ProjectMember[] {
    const rows = this.db
      .prepare(`SELECT * FROM project_members WHERE project_key = ? ORDER BY created_at`)
      .all(projectKey) as Row[];
    return rows.map((r) =>
      ProjectMember.parse({ projectKey: r.project_key, userId: r.user_id, role: r.role, createdAt: r.created_at, lastSeenAt: r.last_seen_at ?? null })
    );
  }

  listMemberProjectKeys(userId: string): string[] {
    const rows = this.db
      .prepare(`SELECT project_key FROM project_members WHERE user_id = ?`)
      .all(userId) as Row[];
    return rows.map((r) => r.project_key as string);
  }

  listUsers(): User[] {
    const rows = this.db.prepare(`SELECT * FROM users ORDER BY created_at`).all() as Row[];
    return rows.map((r) =>
      User.parse({ id: r.id, email: r.email, name: r.name, role: r.role, createdAt: r.created_at, lastSeenAt: r.last_seen_at ?? null })
    );
  }

  countUsers(): number {
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
    return r.n;
  }

  touchUser(id: string): void {
    this.db.prepare(`UPDATE users SET last_seen_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  }

  addAiUsage(row: AiUsage): void {
    this.db
      .prepare(
        `INSERT INTO ai_usage (id, kind, model, input_tokens, output_tokens, user_id, project_key, issue_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(row.id, row.kind, row.model, row.inputTokens, row.outputTokens, row.userId, row.projectKey, row.issueId, row.createdAt);
  }

  listAiUsage(): AiUsage[] {
    const rows = this.db.prepare(`SELECT * FROM ai_usage ORDER BY created_at DESC`).all() as Row[];
    return rows.map((r) =>
      AiUsage.parse({
        id: r.id,
        kind: r.kind,
        model: r.model,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        userId: r.user_id ?? null,
        projectKey: r.project_key ?? null,
        issueId: r.issue_id ?? null,
        createdAt: r.created_at,
      })
    );
  }

  addDriftFinding(row: DriftFinding): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO drift_findings
         (id, issue_id, spec_record_id, anchor, approved_intent, new_observation, contradiction, severity, code_hash, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.issueId,
        row.specRecordId,
        row.anchor,
        row.approvedIntent,
        row.newObservation,
        row.contradiction,
        row.severity,
        row.codeHash,
        row.status,
        row.createdAt
      );
  }

  listDriftFindings(issueId: string, status?: DriftStatus): DriftFinding[] {
    const sql = status
      ? `SELECT * FROM drift_findings WHERE issue_id = ? AND status = ? ORDER BY
           CASE severity WHEN 'high' THEN 0 WHEN 'med' THEN 1 ELSE 2 END, created_at DESC`
      : `SELECT * FROM drift_findings WHERE issue_id = ? ORDER BY
           CASE severity WHEN 'high' THEN 0 WHEN 'med' THEN 1 ELSE 2 END, created_at DESC`;
    const rows = (status
      ? this.db.prepare(sql).all(issueId, status)
      : this.db.prepare(sql).all(issueId)) as Row[];
    return rows.map((r) =>
      DriftFinding.parse({
        id: r.id,
        issueId: r.issue_id,
        specRecordId: r.spec_record_id,
        anchor: r.anchor,
        approvedIntent: r.approved_intent,
        newObservation: r.new_observation,
        contradiction: r.contradiction,
        severity: r.severity,
        codeHash: r.code_hash,
        status: r.status,
        createdAt: r.created_at,
      })
    );
  }

  setDriftStatus(id: string, status: DriftStatus): void {
    this.db.prepare(`UPDATE drift_findings SET status = ? WHERE id = ?`).run(status, id);
  }

  clearOpenDriftFindings(issueId: string): void {
    this.db.prepare(`DELETE FROM drift_findings WHERE issue_id = ? AND status = 'open'`).run(issueId);
  }

  getDriftIssueId(id: string): string | null {
    const r = this.db.prepare(`SELECT issue_id FROM drift_findings WHERE id = ?`).get(id) as Row | undefined;
    return r ? (r.issue_id as string) : null;
  }

  getRequest(recordId: string): HttpRequest | null {
    const r = this.db.prepare(`SELECT * FROM item_request WHERE record_id = ?`).get(recordId) as Row | undefined;
    if (!r) return null;
    return HttpRequest.parse({
      recordId: r.record_id,
      method: r.method,
      url: r.url,
      headers: r.headers,
      body: r.body,
      lastStatus: r.last_status,
      lastMs: r.last_ms,
      lastResponse: r.last_response,
      updatedAt: r.updated_at,
    });
  }

  saveRequest(
    recordId: string,
    req: { method: string; url: string; headers: string | null; body: string | null }
  ): void {
    this.db
      .prepare(
        `INSERT INTO item_request (record_id, method, url, headers, body, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(record_id) DO UPDATE SET
           method=excluded.method, url=excluded.url, headers=excluded.headers,
           body=excluded.body, updated_at=excluded.updated_at`
      )
      .run(recordId, req.method, req.url, req.headers, req.body, new Date().toISOString());
  }

  setRequestResponse(recordId: string, status: number, ms: number, response: string): void {
    this.db
      .prepare(`UPDATE item_request SET last_status = ?, last_ms = ?, last_response = ? WHERE record_id = ?`)
      .run(status, ms, response, recordId);
  }

  close(): void {
    this.db.close();
  }
}
