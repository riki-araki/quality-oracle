// app/lib/page-header.tsx — 全画面で共通のページヘッダー。
// 「パンくず ＋ 見出し（任意の eyebrow）＋ 一言説明 ＋ 右にアクション」の型に揃える。

import type { ReactNode } from "react";

export interface Crumb {
  label: string;
  href?: string;
}

export function PageHeader({
  breadcrumb,
  eyebrow,
  title,
  titleWrap,
  subtitle,
  actions,
  className,
}: {
  breadcrumb?: Crumb[];
  eyebrow?: ReactNode;
  title: ReactNode;
  /** 長い見出し（質問文など）を省略せず折り返す。 */
  titleWrap?: boolean;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`mb-5 ${className ?? ""}`}>
      {breadcrumb && breadcrumb.length > 0 ? (
        <nav className="mb-2 flex flex-wrap items-center gap-1 text-[12px] text-muted">
          {breadcrumb.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 ? <span className="text-faint">/</span> : null}
              {c.href ? (
                <a href={c.href} className="truncate text-muted no-underline hover:text-ink">{c.label}</a>
              ) : (
                <span className="truncate">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? (
            <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.08em] text-muted">{eyebrow}</div>
          ) : null}
          <h1 className={`text-xl font-semibold tracking-tight ${titleWrap ? "leading-snug" : "truncate"}`}>{title}</h1>
          {subtitle ? <p className="mt-1 text-[13px] text-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
