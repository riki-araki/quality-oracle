"use client";
// app/lib/evidence-image.tsx — 証跡画像のサムネ＋クリックでライトボックス拡大。
// Esc / 背景クリックで閉じる。新しいタブで開くリンクも用意。

import { useEffect, useState } from "react";
import { Icon } from "@/app/lib/icons";

export function EvidenceImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block w-full cursor-zoom-in" title="クリックで拡大">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="h-32 w-full object-cover" />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div className="absolute right-4 top-4 flex items-center gap-2">
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="grid size-9 place-items-center rounded-lg border border-white/20 text-white/90 no-underline hover:bg-white/10"
              title="新しいタブで開く"
            >
              <Icon name="download" size={16} />
            </a>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="grid size-9 place-items-center rounded-lg border border-white/20 text-white/90 hover:bg-white/10"
              title="閉じる (Esc)"
            >
              <Icon name="x" size={16} />
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  );
}
