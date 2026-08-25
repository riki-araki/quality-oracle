// app/project/new/page.tsx — プロジェクトを作成する（decisions/0012）。

import { redirect } from "next/navigation";
import { openLedger } from "@/app/lib/db";
import { Sidebar } from "@/app/lib/sidebar";
import { buildTree } from "@/app/lib/model";
import { createProjectAction } from "@/app/actions";
import { currentUser, accessibleProjectKeys, filterTree } from "@/app/lib/access";
import { PageHeader } from "@/app/lib/page-header";
import { SubmitButton } from "@/app/lib/submit-button";
import { Icon } from "@/app/lib/icons";

export const dynamic = "force-dynamic";

const fieldLabel = "mb-1 block text-[11px] font-medium text-faint";

export default async function NewProjectPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const ledger = openLedger();
  const inp = "w-full field";
  try {
    const tree = filterTree(
      buildTree(ledger.listProjects(), ledger.listIssues(), ledger.listRecords({})),
      accessibleProjectKeys(ledger, user)
    );
    return (
      <div className="flex">
        <Sidebar tree={tree} />
        <main className="h-screen flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl p-6">
            <PageHeader
              breadcrumb={[{ label: "← 戻る", href: "/" }]}
              title="プロジェクトを作成"
              subtitle="プロジェクトは課題（PR/範囲）を束ねる単位です。複数のリポジトリやPRをまたいで束ねられます。"
            />

            <form action={createProjectAction} className="card space-y-4 p-5">
              <div>
                <label className={fieldLabel}>プロジェクト名</label>
                <input name="label" required placeholder="例: 決済リニューアル 2026Q3" className={inp} />
              </div>
              <div>
                <label className={fieldLabel}>説明</label>
                <textarea name="description" rows={3} placeholder="このプロジェクトの目的・範囲など" className={`${inp} resize-y`} />
              </div>
              <div>
                <label className={fieldLabel}>GitHub リポジトリ連携（任意）</label>
                <input name="repo" placeholder="owner/repo（URLでも可）" className={inp} />
                <p className="mt-1 text-[11px] text-faint">連携すると、課題作成時に PR番号やパスだけで指定できます（private は gh 認証を自動利用）。</p>
              </div>
              <SubmitButton className="btn-primary" pendingText="作成中…">
                <Icon name="plus" size={14} /> 作成
              </SubmitButton>
            </form>
          </div>
        </main>
      </div>
    );
  } finally {
    ledger.close();
  }
}
