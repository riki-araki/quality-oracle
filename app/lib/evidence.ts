// app/lib/evidence.ts — 証跡（スクショ等）のローカル保存（decisions/0006）。
// ファイル実体は data/evidence/<recordId>/ に置き、メタは台帳DBに記録する。
// 将来ホスト化時は保存先を S3 等へ差し替える（§5.1 の「使うほど赤字」を避けるため当面ローカル）。

import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { openLedger } from "@/app/lib/db";
import type { Evidence } from "@/src/engine/schema";

const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
const MAX_BYTES = 8 * 1024 * 1024; // 8MB/枚

export async function saveEvidence(
  recordId: string,
  file: File,
  note: string | null
): Promise<Evidence> {
  const ext = ALLOWED[file.type];
  if (!ext) throw new Error(`対応していない形式です（PNG/JPEG/GIF/WebP のみ）: ${file.type || "不明"}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) throw new Error("空のファイルです。");
  if (bytes.length > MAX_BYTES) throw new Error(`8MB を超えています（${Math.round(bytes.length / 1e6)}MB）。`);

  const createdAt = new Date().toISOString();
  const id = createHash("sha1").update(bytes).update(file.name).update(createdAt).digest("hex").slice(0, 16);
  const relPath = join("data", "evidence", recordId, `${id}.${ext}`);
  const absPath = join(process.cwd(), relPath);
  mkdirSync(join(process.cwd(), "data", "evidence", recordId), { recursive: true });
  writeFileSync(absPath, bytes);

  const ledger = openLedger();
  try {
    ledger.addEvidence({
      id,
      recordId,
      filename: file.name || `${id}.${ext}`,
      mime: file.type,
      size: bytes.length,
      storedPath: relPath,
      note: note && note.trim() ? note : null,
      createdAt,
    });
  } finally {
    ledger.close();
  }
  return { id, recordId, filename: file.name, mime: file.type, size: bytes.length, note, createdAt };
}

// HTTP送受信などのテキストを証跡として保存する（画像スクショと並ぶ証跡。decisions/0014）。
export function saveTextEvidence(recordId: string, filename: string, text: string, note: string | null): Evidence {
  const bytes = Buffer.from(text, "utf8");
  const createdAt = new Date().toISOString();
  const id = createHash("sha1").update(bytes).update(filename).update(createdAt).digest("hex").slice(0, 16);
  const relPath = join("data", "evidence", recordId, `${id}.txt`);
  mkdirSync(join(process.cwd(), "data", "evidence", recordId), { recursive: true });
  writeFileSync(join(process.cwd(), relPath), bytes);

  const ledger = openLedger();
  try {
    ledger.addEvidence({
      id,
      recordId,
      filename,
      mime: "text/plain",
      size: bytes.length,
      storedPath: relPath,
      note: note && note.trim() ? note : null,
      createdAt,
    });
  } finally {
    ledger.close();
  }
  return { id, recordId, filename, mime: "text/plain", size: bytes.length, note, createdAt };
}

export function serveEvidence(id: string): { bytes: Buffer; mime: string; filename: string } | null {
  const ledger = openLedger();
  try {
    const f = ledger.getEvidenceFile(id);
    if (!f) return null;
    const bytes = readFileSync(join(process.cwd(), f.storedPath));
    return { bytes, mime: f.mime, filename: f.filename };
  } finally {
    ledger.close();
  }
}

export function removeEvidence(id: string): void {
  const ledger = openLedger();
  try {
    const f = ledger.getEvidenceFile(id);
    if (f) {
      try {
        rmSync(join(process.cwd(), f.storedPath), { force: true });
      } catch {
        /* ファイルが無くてもメタは消す */
      }
      ledger.deleteEvidence(id);
    }
  } finally {
    ledger.close();
  }
}
