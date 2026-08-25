import type { ReactNode } from "react";
import "./globals.css";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "@/app/lib/toast";
import { CommandPalette } from "@/app/lib/command-palette";

export const metadata = {
  title: "quality-oracle",
  description: "AIは観測と問いだけ、人間は正解の承認だけ（オラクル引き出し）",
};

// 描画前にテーマを確定して FOUC を防ぐ（localStorage の choice、無ければ既定 dark）。
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var dark=t? t==='dark':true;document.documentElement.classList.toggle('dark',dark);}catch(e){document.documentElement.classList.add('dark');}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="h-screen overflow-hidden antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
        <Toaster />
        <CommandPalette />
      </body>
    </html>
  );
}
