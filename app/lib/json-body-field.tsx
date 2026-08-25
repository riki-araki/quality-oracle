"use client";
// app/lib/json-body-field.tsx — HTTPボディ入力。「整形」ボタンで JSON を pretty-print。
// 編集可能なテキストエリアのまま（フォーム送信は name=body で通る）。

import { useRef, useState } from "react";

export function JsonBodyField({
  defaultValue,
  placeholder,
  className,
}: {
  defaultValue: string;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [err, setErr] = useState<string | null>(null);

  function format() {
    const el = ref.current;
    if (!el) return;
    const v = el.value.trim();
    if (!v) return;
    try {
      el.value = JSON.stringify(JSON.parse(v), null, 2);
      setErr(null);
    } catch {
      setErr("JSON として整形できませんでした。");
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] text-faint">ボディ（JSON等・GET/HEADでは無視）</span>
        <button
          type="button"
          onClick={format}
          className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted hover:border-accent hover:text-ink"
        >
          整形
        </button>
      </div>
      <textarea ref={ref} name="body" rows={4} defaultValue={defaultValue} placeholder={placeholder} className={className} />
      {err ? <p className="mt-1 text-[11px] text-bad">{err}</p> : null}
    </div>
  );
}
