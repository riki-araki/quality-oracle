// app/lib/http.ts — 手動HTTPコンソールの送信（サーバ側で実行）。decisions/0014。
// 人が組み立てたリクエストを送り、レスポンスを返す（合否は人が判定）。自動テスト実行ではない。
// ※ローカル/自ホスト単一ユーザー前提。ホスト共有時は送信先制限(SSRF対策)が必要。

const TIMEOUT_MS = 20_000;
const MAX_BODY = 64 * 1024; // 保存するレスポンス本文の上限

function parseHeaders(text: string | null): Record<string, string> {
  const h: Record<string, string> = {};
  for (const line of (text ?? "").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k) h[k] = v;
  }
  return h;
}

export interface HttpResult {
  status: number;
  ms: number;
  response: string;
}

export async function sendHttp(req: {
  method: string;
  url: string;
  headers: string | null;
  body: string | null;
}): Promise<HttpResult> {
  const method = (req.method || "GET").toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD" && req.body != null && req.body !== "";
  const start = Date.now();
  try {
    const res = await fetch(req.url, {
      method,
      headers: parseHeaders(req.headers),
      body: hasBody ? req.body! : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "manual",
    });
    const ms = Date.now() - start;
    const text = await res.text();
    const head = `HTTP ${res.status} ${res.statusText}\n` +
      [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
    const bodyText = text.length > MAX_BODY ? text.slice(0, MAX_BODY) + "\n…(truncated)" : text;
    return { status: res.status, ms, response: `${head}\n\n${bodyText}` };
  } catch (e) {
    const ms = Date.now() - start;
    const reason = e instanceof Error && e.name === "TimeoutError" ? `タイムアウト(${TIMEOUT_MS / 1000}s)` : e instanceof Error ? e.message : String(e);
    return { status: 0, ms, response: `送信に失敗: ${reason}` };
  }
}
