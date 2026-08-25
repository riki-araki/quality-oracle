"use client";
// app/lib/member-role-select.tsx — メンバーのロール変更（選択で即保存＋トースト）。

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setMemberRoleAction } from "@/app/actions";
import { toast } from "@/app/lib/toast";

export function MemberRoleSelect({
  projectKey,
  userId,
  role,
}: {
  projectKey: string;
  userId: string;
  role: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const fd = new FormData();
    fd.set("projectKey", projectKey);
    fd.set("userId", userId);
    fd.set("role", e.target.value);
    startTransition(async () => {
      try {
        await setMemberRoleAction(fd);
        router.refresh();
        toast("ロールを更新しました");
      } catch (err) {
        toast(err instanceof Error ? err.message : "更新に失敗しました", "error");
      }
    });
  }

  return (
    <select defaultValue={role} onChange={onChange} disabled={pending} className="select text-[12px]">
      <option value="owner">owner</option>
      <option value="member">member</option>
      <option value="viewer">viewer</option>
    </select>
  );
}
