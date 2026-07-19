# 立欣診所線上預約系統（LI HSIN CLINIC Booking System)

診所**完全自有**的線上預約系統：自有程式碼、自有 PostgreSQL 資料庫、自有 LINE／簡訊帳號，
不依賴 BookNow 或任何第三方預約 SaaS，可整目錄搬移至任何主機。

- 前台：民眾七步驟預約、查詢/取消/改期、LINE 登入或手機驗證碼
- 後台：櫃檯今日總覽、代約、排班與休診、病人與未到/黑名單管理、員工權限、系統設定、稽核
- 引擎：交易＋資料庫鎖防超賣；同日唯一、7 天 3 筆、14 天滾動開放、未到自動限制
- 安全：bcrypt、管理員 TOTP 2FA、證件號 AES-256-GCM 加密＋遮罩、rate limiting、完整稽核

## 技術架構

Next.js 15（App Router）＋ TypeScript ＋ Tailwind CSS 4 ＋ PostgreSQL 16 ＋ Prisma ＋ Zod ＋ Vitest ＋ Docker。
時區固定 Asia/Taipei；全站繁體中文。

## 快速開始

```bash
npm install
cp .env.example .env          # 填 DATABASE_URL 與密鑰
npx prisma migrate deploy
npm run db:seed               # 預設醫師/門診/班表 + admin/counter1 測試帳號
npm run dev                   # 前台 http://localhost:3000，後台 /admin
npm test                      # 31 項自動化測試（涵蓋 18 項驗收條件的後端部分）
```

## 文件索引（docs/）

| 檔案 | 內容 |
|---|---|
| 01-需求整理與待確認 | 需求落地總覽＋**待院長確認清單** |
| 02-使用流程 | 前台/後台/排班/通知流程圖 |
| 03-資料庫ERD | ERD 與唯一性約束設計 |
| 04-權限與預約規則 | 角色權限矩陣、狀態機、規則與文案 |
| 05-LINE串接設定 | LINE Login／Messaging API 申請與設定步驟 |
| 06-部署與備份 | 本機啟動、Docker 正式部署、備份/還原、金鑰保管 |
| 07-操作手冊 | 櫃檯與管理員日常操作 |

## 專案結構

```
booking-system/
├── prisma/            # schema、migrations（含防超賣 partial unique index）、seed
├── src/lib/           # 預約引擎、排班運算、驗證、加密、LINE/SMS、權限
├── src/app/           # 前台頁面、/admin 後台、server actions、LINE API routes
├── scripts/           # create-admin、send-reminders
├── tests/             # Vitest（名額/併發/限制/排班/安全/隔離）
└── docker-compose.yml # app + db + 自動備份 + 提醒排程
```

> 注意：本目錄位於官網 repo 內，但由 `_redirects` 強制 404，不會被 Netlify 靜態站對外提供；
> 正式部署為獨立服務（建議 `booking.lhpedclinic.com.tw`）。
