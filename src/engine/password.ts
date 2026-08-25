// src/engine/password.ts — パスワードのハッシュ化/検証（decisions/0018）。
// Node 標準の crypto.scrypt を使う（外部依存・ネイティブビルドなし。node:sqlite と同方針）。
// 形式: scrypt$<saltHex>$<hashHex>。検証は定数時間比較。

import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;

/** 平文パスワード → 保存用ハッシュ文字列（salt 同梱）。 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** 平文パスワードと保存ハッシュを照合（定数時間）。形式不正や不一致は false。 */
export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "hex");
  const expected = Buffer.from(parts[2]!, "hex");
  if (salt.length === 0 || expected.length !== KEYLEN) return false;
  const actual = scryptSync(plain, salt, KEYLEN);
  return timingSafeEqual(actual, expected);
}
