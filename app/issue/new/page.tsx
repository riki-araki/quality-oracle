// app/issue/new/page.tsx — プロジェクトから課題を立てる作成画面（decisions/0010）。

import { redirect } from "next/navigation";
import { openLedger } from "@/app/lib/db";
import { Sidebar } from "@/app/lib/sidebar";
import { buildTree } from "@/app/lib/model";
import { createIssueAction } from "@/app/actions";
import { currentUser, accessibleProjectKeys, filterTree, roleForProject, canEdit } from "@/app/lib/access";
import { PageHeader } from "@/app/lib/page-header";
import { SubmitButton } from "@/app/lib/submit-button";
import { Icon } from "@/app/lib/icons";

export const dynamic = "force-dynamic";

const fieldLabel = "mb-1 block text-[11px] font-medium text-faint";

export default async function NewIssuePage({
  searchParams,
}: {
  searchParams: Promise<{ projectKey?: string; p?: string }>;
}) {
  const { projectKey } = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login");
  const ledger = openLedger();
  const inp = "w-full field";
  try {
    // 編集権限のあるプロジェクトだけ選べるようにする（viewer は除外）。
    const tree = filterTree(
      buildTree(ledger.listProjects(), ledger.listIssues(), ledger.listRecords({})),
      accessibleProjectKeys(ledger, user)
    ).filter((p) => canEdit(roleForProject(ledger, user, p.key)));
    return (
      <div className="flex">
        <Sidebar tree={tree} />
        <main className="h-screen flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl p-6">
            <PageHeader
              breadcrumb={[{ label: "← 戻る", href: "/" }]}
              title="課題を立てる"
              subtitle="タイトル・概要・ソースを指定して課題を作成します。作成後に AI分析ナレッジを貯め、観点を出して項目を追加します。"
            />

            <form action={createIssueAction} className="card space-y-4 p-5">
              <div>
                <label className={fieldLabel}>プロジェクト</label>
                <select name="projectKey" className={inp} defaultValue={projectKey ?? tree[0]?.key ?? ""}>
                  {tree.length === 0 ? <option value="manual">（未分類）</option> : null}
                  {tree.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={fieldLabel}>タイトル</label>
                <input name="title" required placeholder="例: 決済フローの受け入れ" className={inp} />
              </div>
              <div>
                <label className={fieldLabel}>概要</label>
                <textarea name="overview" rows={4} placeholder="この課題の背景・対象・狙いなど" className={`${inp} resize-y`} />
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className={fieldLabel}>ソース種別</label>
                  <select name="sourceKind" className={inp} defaultValue="pr">
                    <option value="pr">GitHub PR</option>
                    <option value="file">GitHub ファイル</option>
                    <option value="local">ローカルファイル</option>
                    <option value="none">なし（後で観測）</option>
                  </select>
                </div>
                <div className="min-w-[260px] flex-1">
                  <label className={fieldLabel}>ソース</label>
                  <input name="sourceRef" placeholder="owner/repo#123 / owner/repo:path / ローカルパス" className={inp} />
                </div>
              </div>
              <SubmitButton className="btn-primary" pendingText="作成中…">
                <Icon name="plus" size={14} /> 課題を作成
              </SubmitButton>
              <p className="text-[11px] text-faint">
                ※ PRは <code>owner/repo#123</code>、ファイルは <code>owner/repo:path</code>。
                **プロジェクトにリポジトリを連携**していれば、PR番号（例 <code>123</code>）やパスだけでOK。
                private リポジトリは gh 認証（またはGITHUB_TOKEN）を自動利用。「なし」はソース未指定（観測は後で）。
              </p>
            </form>
          </div>
        </main>
      </div>
    );
  } finally {
    ledger.close();
  }
}
