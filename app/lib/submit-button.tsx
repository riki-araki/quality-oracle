"use client";
// app/lib/submit-button.tsx — 送信中は無効化＋「処理中…」表示（二重送信防止・フィードバック）。
// 既存の <form action={serverAction}> の <button> をこれに置き換えるだけで使える。

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

export function SubmitButton({
  children,
  className = "btn-primary",
  pendingText = "処理中…",
  formAction,
}: {
  children: ReactNode;
  className?: string;
  pendingText?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      formAction={formAction}
      disabled={pending}
      aria-busy={pending}
      className={`${className} ${pending ? "pointer-events-none opacity-70" : ""}`}
    >
      {pending ? pendingText : children}
    </button>
  );
}
