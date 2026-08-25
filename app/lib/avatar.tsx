// app/lib/avatar.tsx — 名前から決定的に色を割り当てるアバター（イニシャル）。
// 一覧やメンバー表示で「誰か」を色でも識別できるようにする。server/client 兼用。

const COLORS = [
  "#0070f3", // blue
  "#7c3aed", // violet
  "#e5484d", // red
  "#d97706", // amber
  "#16a34a", // green
  "#0891b2", // cyan
  "#db2777", // pink
  "#6366f1", // indigo
  "#ca8a04", // gold
  "#475569", // slate
];

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const label = (name || "?").trim();
  const color = COLORS[hash(label) % COLORS.length];
  const initial = label.slice(0, 1).toUpperCase();
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: color, fontSize: Math.round(size * 0.44) }}
      title={label}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
