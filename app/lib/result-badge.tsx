// app/lib/result-badge.tsx — 実行結果の表示（色付きアイコン＋ラベル）。
// 塗りピルより Vercel らしく、両テーマで読める text トークンを使う。server/client 兼用。

import { Icon } from "@/app/lib/icons";
import type { IconName } from "@/app/lib/icons";
import { RESULT_LABEL } from "@/app/lib/ui";

type Status = "pass" | "fail" | "blocked";

const ICON: Record<Status, IconName> = { pass: "check", fail: "x", blocked: "ban" };
const COLOR: Record<Status, string> = { pass: "var(--ok)", fail: "var(--bad)", blocked: "var(--warn)" };

export function ResultBadge({ status, size = 13 }: { status: Status; size?: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-medium" style={{ color: COLOR[status] }}>
      <Icon name={ICON[status]} size={size} strokeWidth={2.5} />
      {RESULT_LABEL[status]}
    </span>
  );
}
