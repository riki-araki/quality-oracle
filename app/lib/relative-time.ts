// app/lib/relative-time.ts — ISO時刻を「3分前 / 2時間前 / 5日前」などの相対表記に。

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "未ログイン";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "未ログイン";
  const sec = Math.floor((Date.now() - then) / 1000);
  if (sec < 60) return "たった今";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}日前`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}ヶ月前`;
  return `${Math.floor(mon / 12)}年前`;
}

/** 最近（既定30分以内）か。アクティブ表示のドット色に使う。 */
export function isRecent(iso: string | null | undefined, withinMin = 30): boolean {
  if (!iso) return false;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return false;
  return Date.now() - then < withinMin * 60 * 1000;
}
