// src/engine/ids.ts
// 安定IDとハッシュの導出。再観測（§6.2⑥）時の突合に使う。

import { createHash } from "node:crypto";

/** 入力コードの内容ハッシュ（どのコード版で観測したかの識別子）。 */
export function contentHash(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

/**
 * 台帳レコードの安定ID。anchor + question から導出。
 * 同じコード・同じ質問なら同じIDになるので、再観測時に過去の人間の承認を保持できる（§6.2⑥）。
 */
export function recordId(anchor: string, question: string): string {
  return createHash("sha1").update(`${anchor}\n${question}`, "utf8").digest("hex").slice(0, 16);
}

/** 監査単位（AuditRun）のID。コードハッシュ + 実行時刻から導出。 */
export function runId(codeHash: string, createdAtIso: string): string {
  return createHash("sha1").update(`${codeHash}\n${createdAtIso}`, "utf8").digest("hex").slice(0, 12);
}
