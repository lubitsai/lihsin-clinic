/** 診所基本資訊（前台顯示用單一來源） */
export const CLINIC = {
  name: "立欣診所",
  englishName: "LI HSIN CLINIC",
  // 全站統一寫法（官網 124 處皆同）：括號寫法在部分手機無法直撥
  phone: "06-2516086",
  phoneHref: "tel:+88662516086",
  address: "台南市北區育德路 467 號",
  website: "https://lhpedclinic.com.tw",
  lineOfficialUrl: process.env.NEXT_PUBLIC_LINE_OA_URL ?? "https://lin.ee/xxxxx",
  mascot: "小鹿醫師團隊",
} as const;
