// app/lib/sidebar.tsx — 画面共通のサイドバー（Project→課題ツリー）。
// Project はオープン/クローズできる（<details>・アクティブな Project は既定で開く）。
// Project 見出し = ダッシュボード(/project?p=) へ、課題 = 管理(/?p&i) へ。

import { auth } from "@/auth";
import { logoutAction } from "@/app/auth-actions";
import { ThemeToggle } from "@/app/lib/theme-toggle";
import { CommandTrigger } from "@/app/lib/command-trigger";
import { Logo } from "@/app/lib/logo";
import { Icon } from "@/app/lib/icons";
import { Avatar } from "@/app/lib/avatar";
import type { ProjectNode } from "@/app/lib/model";

export async function Sidebar({
  tree,
  activeProjectId,
  activeIssueId,
}: {
  tree: ProjectNode[];
  activeProjectId?: string;
  activeIssueId?: string;
}) {
  const user = (await auth())?.user;
  return (
    <aside className="glass flex h-screen w-[272px] shrink-0 flex-col border-r border-line">
      <div className="flex items-center gap-2 px-4 py-3.5">
        <a href="/" className="flex items-center gap-2 no-underline">
          <Logo size={22} />
          <span className="font-semibold tracking-tight text-ink">quality-oracle</span>
        </a>
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
          <a
            href="/project/new"
            title="プロジェクトを作成"
            className="grid size-7 place-items-center rounded-lg border border-line text-muted no-underline hover:border-accent hover:bg-accent-soft hover:text-accent"
          >
            <Icon name="plus" size={15} />
          </a>
        </div>
      </div>
      <div className="px-3 pb-2">
        <CommandTrigger />
      </div>
      <div className="mx-3 divider" />
      <div className="flex-1 overflow-y-auto px-2.5 py-3">
        {tree.length === 0 ? (
          <p className="px-2 py-3 text-[13px] text-muted">データがありません。CLI で観測してください。</p>
        ) : (
          tree.map((p) => {
            const isActiveProject = activeProjectId === p.id;
            const adoptedTotal = p.issues.reduce((n, iss) => n + iss.records.filter((r) => r.adopted).length, 0);
            return (
              <details key={p.id} open={isActiveProject} className="group mb-1">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-panel2 [&::-webkit-details-marker]:hidden">
                  <span className="grid size-4 shrink-0 place-items-center text-[9px] text-faint transition-transform duration-200 group-open:rotate-90">▶</span>
                  <Icon name="folder" size={13} className="shrink-0 text-faint" />
                  <a
                    href={`/project?p=${p.id}`}
                    className={`min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.08em] no-underline ${
                      isActiveProject && !activeIssueId ? "text-accent" : "text-muted hover:text-ink"
                    }`}
                  >
                    {p.label}
                  </a>
                  <span className="shrink-0 rounded-full bg-panel2 px-1.5 py-0.5 text-[10px] tabular-nums text-muted">
                    {p.issues.length}
                    {adoptedTotal > 0 ? `·${adoptedTotal}` : ""}
                  </span>
                </summary>
                <div className="mt-1 mb-1 ml-[1.05rem] flex flex-col gap-0.5 border-l border-line/80 pl-2">
                  {p.issues.length === 0 ? (
                    <p className="px-2 py-1.5 text-[12px] text-faint">課題なし</p>
                  ) : (
                    p.issues.map((iss) => {
                      const adopted = iss.records.filter((r) => r.adopted).length;
                      const active = activeIssueId === iss.id;
                      return (
                        <a
                          key={iss.id}
                          href={`/?p=${p.id}&i=${iss.id}`}
                          className={`group/it relative block rounded-lg px-2.5 py-1.5 text-[13px] no-underline ${
                            active
                              ? "bg-accent-soft font-medium text-ink"
                              : "text-ink/75 hover:bg-panel2 hover:text-ink"
                          }`}
                        >
                          {active ? (
                            <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-x-[9px] -translate-y-1/2 rounded-full bg-accent" />
                          ) : null}
                          <div className="flex items-center gap-1.5">
                            <Icon name="fileText" size={13} className={`shrink-0 ${active ? "text-accent" : "text-faint"}`} />
                            <span className="truncate">{iss.label}</span>
                            {adopted > 0 ? (
                              <span className="ml-auto shrink-0 rounded-full bg-panel2 px-1.5 text-[10px] tabular-nums text-muted">{adopted}</span>
                            ) : null}
                          </div>
                        </a>
                      );
                    })
                  )}
                </div>
              </details>
            );
          })
        )}
      </div>
      {user?.role === "admin" ? (
        <div className="border-t border-line px-2.5 py-2">
          <a
            href="/ai"
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink/75 no-underline hover:bg-panel2 hover:text-ink"
          >
            <Icon name="activity" size={14} className="shrink-0 text-faint" />
            <span>AI使用状況</span>
          </a>
        </div>
      ) : null}
      <div className="border-t border-line px-3 py-2.5">
        {user ? (
          <div className="flex items-center gap-2.5 rounded-lg px-1 py-1">
            <Avatar name={user.name ?? "?"} size={28} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium text-ink">
                {user.name}
                {user.role === "admin" ? <span className="ml-1.5 rounded bg-accent-soft px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-accent">admin</span> : null}
              </div>
              <div className="truncate text-[11px] text-muted">{user.email}</div>
            </div>
            <form action={logoutAction} className="shrink-0">
              <button title="ログアウト" className="grid size-7 place-items-center rounded-lg border border-line text-muted hover:border-accent hover:text-ink">
                <Icon name="logout" size={14} />
              </button>
            </form>
          </div>
        ) : null}
        <p className="mt-2 px-1 text-[11px] text-faint">AIは観測と問いだけ／人間は承認だけ</p>
      </div>
    </aside>
  );
}
