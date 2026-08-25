/** @type {import('next').NextConfig} */
const nextConfig = {
  // 承認画面は engine（node:sqlite を使う台帳）をサーバー側で直接呼ぶ。
  // node ビルトインは既定で外部化されるが、明示しておく。
  serverExternalPackages: ["node:sqlite", "exceljs"],
  // 証跡（画像）アップロードのため Server Action の上限を上げる。
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
