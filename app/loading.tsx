// app/loading.tsx — 画面遷移/データ取得中のスケルトン（アプリの骨格に合わせる）。

export default function Loading() {
  return (
    <div className="flex">
      {/* 疑似サイドバー */}
      <aside className="glass hidden h-screen w-[272px] shrink-0 flex-col border-r border-line lg:flex">
        <div className="flex items-center gap-2 px-4 py-3.5">
          <div className="skeleton size-[22px] rounded-md" />
          <div className="skeleton h-4 w-28" />
        </div>
        <div className="px-3 pb-2">
          <div className="skeleton h-7 w-full" />
        </div>
        <div className="mx-3 divider" />
        <div className="space-y-2 px-4 py-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-5" style={{ width: `${85 - (i % 3) * 18}%` }} />
          ))}
        </div>
      </aside>

      {/* 本文 */}
      <main className="h-screen flex-1 overflow-hidden p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          <div className="skeleton h-3 w-24" />
          <div className="skeleton h-7 w-64" />
          <div className="skeleton h-24 w-full rounded-lg" />
          <div className="skeleton h-9 w-full rounded-lg" />
          <div className="skeleton h-72 w-full rounded-lg" />
        </div>
      </main>
    </div>
  );
}
