"use client";
// app/lib/toast.tsx — 軽量トースト。toast() で通知し、<Toaster/>（layout に常設）が表示。
// window の CustomEvent でやり取りするので、どのクライアント部品からでも呼べる。

import { useEffect, useRef, useState } from "react";

export type ToastKind = "success" | "error" | "info";

export function toast(message: string, kind: ToastKind = "success") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("app-toast", { detail: { message, kind } }));
}

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

const DOT: Record<ToastKind, string> = {
  success: "var(--ok-solid)",
  error: "var(--bad-solid)",
  info: "var(--accent)",
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent).detail as { message: string; kind: ToastKind };
      const id = ++idRef.current;
      setItems((xs) => [...xs, { id, message: detail.message, kind: detail.kind }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 2600);
    }
    window.addEventListener("app-toast", onToast);
    return () => window.removeEventListener("app-toast", onToast);
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className="toast-in pointer-events-auto flex items-center gap-2.5 rounded-lg border border-line bg-panel px-3.5 py-2.5 text-[13px] text-ink shadow-[var(--shadow-pop)]"
        >
          <span className="size-2 shrink-0 rounded-full" style={{ background: DOT[t.kind] }} />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
