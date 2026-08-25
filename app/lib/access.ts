// app/lib/access.ts — マルチユーザーのアクセス制御（データ分離・権限。decisions/0018 Phase2）。
// admin(グローバル)=全アクセス / owner=メンバー管理可 / member=作業可 / viewer=閲覧のみ。

import { auth } from "@/auth";
import { deriveFromPath } from "@/src/engine/issues";
import type { SqliteLedger } from "@/src/engine/ledger";
import type { MemberRole } from "@/src/engine/schema";
import type { ProjectNode } from "@/app/lib/model";

export interface SessionUser {
  id: string;
  role: "admin" | "member";
}

/** 有効ロール: グローバル admin はそのまま "admin"、それ以外はプロジェクト内ロール（未所属 null）。 */
export type EffectiveRole = "admin" | MemberRole | null;

/** 現在のログインユーザー（未ログインは null）。 */
export async function currentUser(): Promise<SessionUser | null> {
  const u = (await auth())?.user;
  if (!u?.id) return null;
  return { id: u.id, role: u.role === "admin" ? "admin" : "member" };
}

/** 課題ID → 所属プロジェクトキー（明示メタ優先、無ければ配下レコードの codeRef から導出）。 */
export function projectKeyForIssue(ledger: SqliteLedger, issueId: string): string | null {
  const meta = ledger.getIssue(issueId);
  if (meta) return meta.projectKey;
  const rec = ledger.listRecords({ issueId })[0];
  if (!rec) return null;
  return deriveFromPath(rec.codeRef.path).projectKey;
}

/** レコードID → 所属プロジェクトキー。 */
export function projectKeyForRecord(ledger: SqliteLedger, recordId: string): string | null {
  const rec = ledger.getRecord(recordId);
  if (!rec) return null;
  const meta = ledger.getIssue(rec.issueId);
  return meta?.projectKey ?? deriveFromPath(rec.codeRef.path).projectKey;
}

/** ユーザーのそのプロジェクトでの有効ロール。 */
export function roleForProject(ledger: SqliteLedger, user: SessionUser, projectKey: string): EffectiveRole {
  if (user.role === "admin") return "admin";
  return ledger.getMemberRole(projectKey, user.id);
}

/** 読み取り可能なプロジェクトキー集合（admin は null＝全件）。 */
export function accessibleProjectKeys(ledger: SqliteLedger, user: SessionUser): Set<string> | null {
  if (user.role === "admin") return null;
  return new Set(ledger.listMemberProjectKeys(user.id));
}

/** ツリーをアクセス可能なプロジェクトだけに絞る（null=全件）。 */
export function filterTree(tree: ProjectNode[], accessible: Set<string> | null): ProjectNode[] {
  if (accessible === null) return tree;
  return tree.filter((p) => accessible.has(p.key));
}

/** 編集可能か（admin/owner/member は可、viewer/未所属は不可）。 */
export function canEdit(role: EffectiveRole): boolean {
  return role === "admin" || role === "owner" || role === "member";
}

/** メンバー管理可能か（admin/owner のみ）。 */
export function canManageMembers(role: EffectiveRole): boolean {
  return role === "admin" || role === "owner";
}
