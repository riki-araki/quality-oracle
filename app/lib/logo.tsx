// app/lib/logo.tsx — ブランドマーク。
// プロダクトの核「AIが観測し、人が承認する（オラクル引き出し）」を、
// アクセント色のタイルに“観測の目（lens）”で表す。小サイズでも読める形。

export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="24" height="24" rx="6" fill="var(--accent)" />
      <path
        d="M4.5 12s2.7-4.8 7.5-4.8 7.5 4.8 7.5 4.8-2.7 4.8-7.5 4.8S4.5 12 4.5 12Z"
        stroke="#fff"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.3" fill="#fff" />
    </svg>
  );
}
