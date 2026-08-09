import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * 開發模式必須額外允許 'unsafe-eval'：`next dev` 的 React Refresh／HMR 會用 eval 載入
 * 客戶端程式，被 CSP 擋掉的話**整個網站不會 hydrate**——畫面看起來正常，但每一顆按鈕
 * 都沒有反應（點門診類型停在步驟 1、登入鈕永遠 disabled）。看起來像程式壞了，其實是
 * CSP 擋住的。正式環境（`next build`）不需要 eval，維持嚴格設定。
 * connect-src 同理放寬給 HMR 的 websocket。
 */
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";
const connectSrc = isDev ? "connect-src 'self' ws: wss:" : "connect-src 'self'";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "img-src 'self' data: https://profile.line-scdn.net",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      connectSrc,
      "frame-ancestors 'none'",
    ].join("; "),
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
