// app/api/export/project/[id]/route.ts — プロジェクトを Excel でダウンロード（課題ごとにシート）。
import { projectWorkbook } from "@/app/lib/export";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await projectWorkbook(id);
  if (!r) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(r.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(r.name)}`,
      "Cache-Control": "no-store",
    },
  });
}
