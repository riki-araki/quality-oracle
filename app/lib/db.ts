// app/lib/db.ts — サーバー側で台帳（engine）を開くヘルパ。
// Next はリポジトリ直下から起動するため、cwd 基準で data/oracle.db を開く
// （engine の REPO_ROOT は import.meta.url 依存なので Next バンドル下では使わない）。

import { join } from "node:path";
import { SqliteLedger } from "@/src/engine/ledger";

export function openLedger(): SqliteLedger {
  return new SqliteLedger(join(process.cwd(), "data", "oracle.db"));
}
