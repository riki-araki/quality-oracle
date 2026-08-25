// src/engine/sources/github.ts
// GitHub を「読み取り専用の入力アダプタ」として扱う（decisions/0004）。
// PR の変更ファイル or 単一ファイルを取得し、既存パイプラインに渡すコード文字列にするだけ。
// engine の核（観測/尋問/承認/台帳）には手を入れない＝GitHub は入口であって堀ではない（§3.2）。
//
// 認証: GITHUB_TOKEN（.env）があれば private も可。無ければ public のみ。書き戻しはしない。

const API = "https://api.github.com";

export interface FetchedSource {
  /** パイプラインに渡す連結済みコード（ファイル境界コメント付き）。 */
  code: string;
  /** §6.9「最終照合」用の素性。例: gh:owner/repo#123@abc1234 */
  path: string;
  /** 取り込んだファイル名一覧。 */
  files: string[];
}

function ghHeaders(token: string | undefined, accept: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "quality-oracle",
  };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

// パス区切りの / は保持しつつ各セグメントをエンコード（# ? 空白等を含むファイル名に対応）。
function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

// 認証が要る可能性のある 404/403 で、トークン未設定ならヒントを足す（ghJson/ghRaw 共通）。
function notOkMessage(
  kind: string,
  status: number,
  statusText: string,
  path: string,
  token: string | undefined
): string {
  const hint =
    (status === 404 || status === 403) && !token
      ? " （private なら GITHUB_TOKEN を設定してください）"
      : "";
  return `GitHub ${kind} ${status} ${statusText}: ${path}${hint}`;
}

const REQUEST_TIMEOUT_MS = 30_000;

// タイムアウト・接続失敗等の fetch 例外を統一メッセージで包む。
// 応答が無いと Promise が永久に解決しないため、AbortSignal で打ち切る。
async function ghFetch(path: string, accept: string, token: string | undefined): Promise<Response> {
  try {
    return await fetch(API + path, {
      headers: ghHeaders(token, accept),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    const reason =
      e instanceof Error && e.name === "TimeoutError"
        ? `タイムアウト（${REQUEST_TIMEOUT_MS / 1000}s）`
        : e instanceof Error
          ? e.message
          : String(e);
    throw new Error(`GitHub への接続に失敗: ${path}（${reason}）`);
  }
}

async function ghJson(path: string, token: string | undefined): Promise<unknown> {
  const res = await ghFetch(path, "application/vnd.github+json", token);
  if (!res.ok) throw new Error(notOkMessage("API", res.status, res.statusText, path, token));
  return res.json();
}

async function ghRaw(path: string, token: string | undefined): Promise<string> {
  const res = await ghFetch(path, "application/vnd.github.raw", token);
  if (!res.ok) throw new Error(notOkMessage("raw", res.status, res.statusText, path, token));
  return res.text();
}

/** "owner/repo#123" を解釈。 */
export function parsePrRef(ref: string): { owner: string; repo: string; number: number } {
  const m = ref.match(/^([^/\s]+)\/([^#\s]+)#(\d+)$/);
  if (!m) throw new Error(`--pr の形式は owner/repo#123 です（受領: ${ref}）`);
  return { owner: m[1]!, repo: m[2]!, number: Number(m[3]) };
}

/** "owner/repo:path/to/file[@ref]" を解釈。ref 省略時は既定ブランチ。 */
export function parseFileRef(ref: string): {
  owner: string;
  repo: string;
  filePath: string;
  gitRef?: string;
} {
  const m = ref.match(/^([^/\s]+)\/([^:\s]+):([^@\s]+)(?:@(.+))?$/);
  if (!m) throw new Error(`--gh の形式は owner/repo:path[@ref] です（受領: ${ref}）`);
  return { owner: m[1]!, repo: m[2]!, filePath: m[3]!, gitRef: m[4] };
}

function fileBlock(name: string, status: string, content: string): string {
  return `// ===== FILE: ${name} (${status}) =====\n${content}`;
}

interface PrInfo {
  head: { sha: string };
}
interface PrFile {
  filename: string;
  status: string;
}

/** PR の変更ファイル全文を取得し、1本のコードに連結する（スコープ選択 #4）。 */
export async function fetchPr(refStr: string, token: string | undefined): Promise<FetchedSource> {
  const { owner, repo, number } = parsePrRef(refStr);
  const pr = (await ghJson(`/repos/${owner}/${repo}/pulls/${number}`, token)) as PrInfo;
  const sha = pr.head.sha;

  // 変更ファイルをページングで全取得。上限超過は黙って切り捨てず明示エラーにする（no silent caps）。
  const MAX_PAGES = 30; // 100 件/頁 × 30 = 3000 件まで
  const all: PrFile[] = [];
  let page = 1;
  while (true) {
    const batch = (await ghJson(
      `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
      token
    )) as PrFile[];
    all.push(...batch);
    if (batch.length < 100) break; // 最終ページ
    if (page >= MAX_PAGES) {
      throw new Error(
        `PR #${number} の変更ファイルが多すぎます（>${MAX_PAGES * 100} 件）。対象を絞ってください。`
      );
    }
    page++;
  }
  const usable = all.filter((f) => f.status !== "removed");
  if (usable.length === 0) throw new Error(`PR #${number} に読み取り可能な変更ファイルがありません。`);

  const parts: string[] = [];
  const names: string[] = [];
  for (const f of usable) {
    const content = await ghRaw(
      `/repos/${owner}/${repo}/contents/${encodePath(f.filename)}?ref=${sha}`,
      token
    );
    parts.push(fileBlock(f.filename, f.status, content));
    names.push(f.filename);
  }
  return {
    code: parts.join("\n\n"),
    path: `gh:${owner}/${repo}#${number}@${sha.slice(0, 7)}`,
    files: names,
  };
}

/** 単一ファイルを取得する。 */
export async function fetchFile(refStr: string, token: string | undefined): Promise<FetchedSource> {
  const { owner, repo, filePath, gitRef } = parseFileRef(refStr);
  const q = gitRef ? `?ref=${encodeURIComponent(gitRef)}` : "";
  const content = await ghRaw(`/repos/${owner}/${repo}/contents/${encodePath(filePath)}${q}`, token);
  return {
    code: fileBlock(filePath, "file", content),
    path: `gh:${owner}/${repo}:${filePath}${gitRef ? "@" + gitRef : ""}`,
    files: [filePath],
  };
}
