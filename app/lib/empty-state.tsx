// app/lib/empty-state.tsx — データが無い時の共通の空状態（アイコン＋説明＋導線）。

import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon ? (
        <div className="mb-3 grid size-12 place-items-center rounded-full border border-line bg-panel2/50 text-muted">
          {icon}
        </div>
      ) : null}
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {description ? <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
