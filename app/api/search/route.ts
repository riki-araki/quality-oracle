// app/api/search/route.ts — コマンドパレット(⌘K)用のナビゲーション索引。
// アクセス可能なプロジェクト/課題/採用項目を返す（権限フィルタ済み）。

import { openLedger } from "@/app/lib/db";
import { buildTree } from "@/app/lib/model";
import { currentUser, accessibleProjectKeys, filterTree } from "@/app/lib/access";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ items: [] }, { status: 401 });

  const ledger = openLedger();
  try {
    const tree = filterTree(
      buildTree(ledger.listProjects(), ledger.listIssues(), ledger.listRecords({})),
      accessibleProjectKeys(ledger, user)
    );
    const items: { type: "project" | "issue" | "item"; label: string; sub: string; href: string }[] = [];
    for (const p of tree) {
      items.push({ type: "project", label: p.label, sub: "プロジェクト", href: `/project?p=${p.id}` });
      for (const iss of p.issues) {
        items.push({ type: "issue", label: iss.label, sub: p.label, href: `/?p=${p.id}&i=${iss.id}` });
        for (const r of iss.records) {
          if (!r.adopted) continue;
          items.push({
            type: "item",
            label: r.generatedTest ? r.generatedTest.title : r.question,
            sub: iss.label,
            href: `/item/${r.id}`,
          });
        }
      }
    }
    return Response.json({ items });
  } finally {
    ledger.close();
  }
}
