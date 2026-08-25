"use client";
// app/lib/paste-upload.tsx — 証跡スクショの高速アップロード。
// Ctrl+V 貼り付け（ページ全体・入力欄フォーカス中は無視）／ドラッグ&ドロップ／クリックで選択。
// サーバーアクション uploadEvidenceAction を直接呼び、完了後に router.refresh で再描画。

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadEvidenceAction } from "@/app/actions";
import { toast } from "@/app/lib/toast";
import { Icon } from "@/app/lib/icons";

export function PasteUpload({ recordId }: { recordId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function upload(file: File) {
    if (!file.type.startsWith("image/")) {
      setErr("画像ファイルのみ対応しています。");
      return;
    }
    setErr(null);
    const fd = new FormData();
    fd.set("recordId", recordId);
    fd.set("file", file);
    startTransition(async () => {
      try {
        await uploadEvidenceAction(fd);
        router.refresh();
        toast("証跡を追加しました");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "アップロードに失敗しました。";
        setErr(msg);
        toast(msg, "error");
      }
    });
  }

  // ページ全体の貼り付けを拾う。入力欄にフォーカス中はテキスト貼り付けを邪魔しない。
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of Array.from(items)) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            upload(f);
            break;
          }
        }
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  return (
    <div className="mt-4 border-t border-line pt-3">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-5 text-center text-[12px] transition-colors ${
          over
            ? "border-accent bg-accent-soft/50 text-accent"
            : "border-strong text-muted hover:border-accent hover:text-ink"
        }`}
      >
        {pending ? (
          <span className="text-accent">アップロード中…</span>
        ) : (
          <>
            <Icon name="clipboard" size={20} className="text-muted" />
            <span className="mt-1.5">
              <b>Ctrl+V で貼り付け</b>・ドラッグ&amp;ドロップ・クリックで選択
            </span>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </div>
      {err ? <p className="mt-2 text-[12px] text-bad">{err}</p> : null}
      <p className="mt-2 text-[11px] text-muted">PNG/JPEG/GIF/WebP・8MBまで。data/ にローカル保存。</p>
    </div>
  );
}
