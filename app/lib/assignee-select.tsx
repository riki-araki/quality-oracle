"use client";
// app/lib/assignee-select.tsx — 担当者の割り当て（選択で即保存＋トースト）。

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAssigneeAction } from "@/app/actions";
import { toast } from "@/app/lib/toast";

export function AssigneeSelect({
  recordId,
  value,
  members,
}: {
  recordId: string;
  value: string | null;
  members: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const assignee = e.target.value;
    const fd = new FormData();
    fd.set("recordId", recordId);
    fd.set("assignee", assignee);
    startTransition(async () => {
      try {
        await setAssigneeAction(fd);
        router.refresh();
        toast(assignee ? "担当者を更新しました" : "担当を未割当にしました");
      } catch (err) {
        toast(err instanceof Error ? err.message : "更新に失敗しました", "error");
      }
    });
  }

  return (
    <select
      value={value ?? ""}
      onChange={onChange}
      disabled={pending}
      className="max-w-[150px] select"
    >
      <option value="">未割当</option>
      {members.map((m) => (
        <option key={m.id} value={m.id}>{m.name}</option>
      ))}
    </select>
  );
}
