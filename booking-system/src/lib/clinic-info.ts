/** 診所基本資訊（前台顯示用單一來源） */
export const CLINIC = {
  name: "立欣診所",
  englishName: "LI HSIN CLINIC",
  // 全站統一寫法（官網 124 處皆同）：括號寫法在部分手機無法直撥
  phone: "06-2516086",
  phoneHref: "tel:+88662516086",
  address: "台南市北區育德路 467 號",
  website: "https://lhpedclinic.com.tw",
  /**
   * 官網上家長最常需要的三個落點。寫成常數而不是散在各頁：
   * 官網改了錨點，這裡改一次就好。
   */
  // 即時看診進度（首頁區塊）——報到逾時、過號、出發前都用得到
  progressUrl: "https://lhpedclinic.com.tw/#realtime-progress",
  // 完整預約規則（就診指南）
  bookingRulesUrl: "https://lhpedclinic.com.tw/visit-guide.html#booking-rules",
  // 過號後的候診順位規則（就診指南）
  missedNumberUrl: "https://lhpedclinic.com.tw/visit-guide.html#missed-number",
  // 未設定（含 .env.example 的空字串）時退回官網全站使用的加好友網址；
  // 原本的 `?? "https://lin.ee/xxxxx"` 遇到空字串不會退回，首頁連結會變成連回自己
  lineOfficialUrl: process.env.NEXT_PUBLIC_LINE_OA_URL || "https://line.me/R/ti/p/@lhpedclinic",
  mascot: "小鹿醫師團隊",
} as const;
