// src/engine/issues.ts — codeRef から Project/課題の同一性（id・キー・ソース）を導出する。
// 明示課題（issue_meta）と、観測 run から導かれる課題を「同じ id」で統合するための単一の真実源。

export type SourceKind = "pr" | "file" | "local" | "none";

export interface Derived {
  projectKey: string;
  projectLabel: string;
  issueKey: string;
  label: string;
  sourceKind: SourceKind;
  sourceRef: string | null;
}

// djb2（base36）。URL/キーに使う安定ハッシュ。
export function hashKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function issueId(projectKey: string, issueKey: string): string {
  return hashKey(`${projectKey}::${issueKey}`);
}
export function projectId(projectKey: string): string {
  return hashKey(projectKey);
}

/** codeRef.path（または issue_meta の source_ref）から導出。 */
export function deriveFromPath(path: string | null): Derived {
  if (path && path.startsWith("gh:")) {
    const body = path.slice(3);
    const pr = body.match(/^([^/]+\/[^#]+)#(\d+)(?:@(.+))?$/);
    if (pr) {
      return {
        projectKey: pr[1]!,
        projectLabel: pr[1]!,
        issueKey: `#${pr[2]}`,
        label: `PR #${pr[2]}`,
        sourceKind: "pr",
        sourceRef: `gh:${pr[1]}#${pr[2]}`,
      };
    }
    const file = body.match(/^([^/]+\/[^:]+):(.+)$/);
    if (file) {
      return {
        projectKey: file[1]!,
        projectLabel: file[1]!,
        issueKey: file[2]!,
        label: file[2]!,
        sourceKind: "file",
        sourceRef: `gh:${file[1]}:${file[2]}`,
      };
    }
  }
  return {
    projectKey: "local",
    projectLabel: "ローカル",
    issueKey: path ?? "(stdin)",
    label: path ?? "標準入力",
    sourceKind: "local",
    sourceRef: path,
  };
}
