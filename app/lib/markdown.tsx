// app/lib/markdown.tsx — 軽量 Markdown 描画（依存なし・安全）。
// AI分析ナレッジ（箇条書きMD）を整形表示する。見出し/箇条書き/番号/太字に対応。
// React 要素を組み立てる（dangerouslySetInnerHTML は使わない）。

import type { ReactNode } from "react";

// インラインの **太字** を処理。
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];

  const flushList = () => {
    if (!list) return;
    const items = list.items;
    blocks.push(
      list.ordered ? (
        <ol key={blocks.length} className="ml-4 list-decimal space-y-1 marker:text-faint">
          {items.map((it, i) => (
            <li key={i}>{inline(it)}</li>
          ))}
        </ol>
      ) : (
        <ul key={blocks.length} className="ml-4 list-disc space-y-1 marker:text-faint">
          {items.map((it, i) => (
            <li key={i}>{inline(it)}</li>
          ))}
        </ul>
      )
    );
    list = null;
  };

  // 連続する散文行は1つの段落にまとめ、行間は <br/> で保つ（日本語の改行を尊重）。
  const flushPara = () => {
    if (!para.length) return;
    const items = para;
    blocks.push(
      <p key={blocks.length}>
        {items.map((l, i) => (
          <span key={i}>
            {inline(l)}
            {i < items.length - 1 ? <br /> : null}
          </span>
        ))}
      </p>
    );
    para = [];
  };

  for (const raw of lines) {
    const t = raw.trim();
    if (!t) {
      flushList();
      flushPara();
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(t);
    if (h) {
      flushList();
      flushPara();
      const lvl = (h[1] ?? "").length;
      blocks.push(
        <p key={blocks.length} className={`mt-2 font-semibold text-ink ${lvl <= 2 ? "text-[13.5px]" : "text-[12.5px]"}`}>
          {inline(h[2] ?? "")}
        </p>
      );
      continue;
    }
    const ul = /^[-*・]\s+(.*)$/.exec(t);
    if (ul) {
      flushPara();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(ul[1] ?? "");
      continue;
    }
    const ol = /^\d+[.)]\s+(.*)$/.exec(t);
    if (ol) {
      flushPara();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ol[1] ?? "");
      continue;
    }
    flushList();
    para.push(t);
  }
  flushList();
  flushPara();

  return <div className="space-y-1.5 text-[13px] leading-relaxed text-ink/90">{blocks}</div>;
}
