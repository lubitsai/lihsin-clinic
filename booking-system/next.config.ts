import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; img-src 'self' data: https://profile.line-scdn.net; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
  },
];

const nextConfig: NextConfig = {
  // Docker 部署用：只打包實際用到的檔案。
  // 注意：本機若要用 next start 驗證，需暫時註解掉這行（standalone 產物要用
  // node .next/standalone/server.js 啟動，直接 next start 會找不到 CSS 與 chunks）。
  output: "standalone",
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
