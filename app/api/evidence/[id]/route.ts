// app/api/evidence/[id]/route.ts — ローカル保存した証跡画像を配信する。
// data/ 配下（.gitignore）に置くため、この経由で読み出す。

import { serveEvidence } from "@/app/lib/evidence";
import { openLedger } from "@/app/lib/db";
import { currentUser, projectKeyForRecord, roleForProject } from "@/app/lib/access";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // アクセス制御（Phase2）: 証跡の属するプロジェクトに権限がある人だけ配信する。
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const lg = openLedger();
  let allowed = false;
  try {
    const recId = lg.getEvidenceRecordId(id);
    if (recId) {
      const pk = projectKeyForRecord(lg, recId);
      allowed = !!pk && !!roleForProject(lg, user, pk);
    }
  } finally {
    lg.close();
  }
  if (!allowed) return new Response("Not found", { status: 404 });

  const ev = serveEvidence(id);
  if (!ev) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(ev.bytes), {
    headers: {
      "Content-Type": ev.mime,
      "Cache-Control": "no-store",
    },
  });
}
