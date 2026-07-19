import Link from "next/link";
import { prisma } from "@/lib/db";
import { todayStr, addDays, formatDateTw } from "@/lib/tw-time";
import { getDayScheduleBlocks, SESSION_LABEL } from "@/lib/schedule";
import { dateToDb } from "@/lib/tw-time";
import { CLINIC } from "@/lib/clinic-info";
import { Card, DeerMascot, Alert } from "@/components/ui";
import { isLineLoginConfigured } from "@/lib/line";

export const dynamic = "force-dynamic";

async function getRecentNotices() {
  const today = todayStr();
  const rows = await prisma.scheduleException.findMany({
    where: {
      date: { gte: dateToDb(today), lte: dateToDb(addDays(today, 6)) },
      type: { in: ["CLINIC_CLOSED_DAY", "SESSION_CLOSED", "DOCTOR_OFF", "SPECIAL_HOURS", "EXTRA_SESSION"] },
    },
    orderBy: { date: "asc" },
    take: 5,
  });
  return rows;
}

export default async function HomePage() {
  const today = todayStr();
  const [blocks, notices, doctors] = await Promise.all([
    getDayScheduleBlocks(today),
    getRecentNotices(),
    prisma.doctor.findMany({ where: { isActive: true }, orderBy: { displayOrder: "asc" } }),
  ]);
  const doctorName = new Map(doctors.map((d) => [d.id, d.name]));
  const todaySessions = [...new Set(blocks.map((b) => b.session))];

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      <header className="flex items-center gap-4">
        <DeerMascot size={72} />
        <div>
          <p className="text-bark-500 text-sm font-medium tracking-wide">{CLINIC.englishName}</p>
          <h1 className="text-3xl font-bold text-forest-700">{CLINIC.name}線上預約</h1>
          <p className="text-stone-600 mt-1">小鹿醫師團隊陪伴大小朋友安心就診</p>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          href="/book"
          className="rounded-card bg-forest-600 hover:bg-forest-700 text-white text-center py-6 text-2xl font-bold shadow-md transition"
        >
          🗓️ 立即預約
        </Link>
        <Link
          href="/my"
          className="rounded-card bg-persimmon-500 hover:bg-persimmon-600 text-white text-center py-6 text-2xl font-bold shadow-md transition"
        >
          🔍 查詢／取消預約
        </Link>
      </div>

      <Card>
        <h2 className="text-lg font-bold text-forest-700 mb-2">今日門診（{formatDateTw(today)}）</h2>
        {todaySessions.length === 0 ? (
          <p className="text-stone-600">今日休診。如有需要請致電診所詢問。</p>
        ) : (
          <ul className="space-y-1">
            {(["MORNING", "AFTERNOON", "EVENING"] as const)
              .filter((s) => todaySessions.includes(s))
              .map((s) => {
                const bs = blocks.filter((b) => b.session === s);
                return (
                  <li key={s} className="flex flex-wrap gap-x-3 text-stone-700">
                    <span className="font-medium text-bark-600 w-12">{SESSION_LABEL[s]}</span>
                    <span>
                      {bs[0].startTime}–{bs[0].endTime}｜
                      {[...new Set(bs.map((b) => doctorName.get(b.doctorId)))].join("、")}醫師
                    </span>
                  </li>
                );
              })}
          </ul>
        )}
      </Card>

      {notices.length > 0 && (
        <Alert tone="warn">
          <p className="font-bold mb-1">近期門診異動</p>
          <ul className="list-disc list-inside space-y-0.5">
            {notices.map((n) => (
              <li key={n.id}>
                {formatDateTw(n.date.toISOString().slice(0, 10))}：{n.reason}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <Alert tone="info">
        線上預約為看診時段登記，<strong>不等於實際看診號碼</strong>，現場依報到順序與醫師看診狀況候診，敬請見諒。
      </Alert>

      <Card className="space-y-2">
        <h2 className="text-lg font-bold text-forest-700">聯絡立欣診所</h2>
        <p>
          📞 電話：
          <a href={CLINIC.phoneHref} className="text-forest-600 font-bold underline underline-offset-2">
            {CLINIC.phone}
          </a>
        </p>
        <p>📍 地址：{CLINIC.address}</p>
        <p>
          🌐 官方網站：
          <a href={CLINIC.website} className="text-forest-600 underline underline-offset-2" rel="noopener">
            lhpedclinic.com.tw
          </a>
        </p>
        {isLineLoginConfigured() && (
          <p>
            💬 LINE 官方帳號：
            <a href={CLINIC.lineOfficialUrl} className="text-forest-600 underline underline-offset-2" rel="noopener">
              加入好友接收看診提醒
            </a>
          </p>
        )}
      </Card>

      <footer className="text-center text-sm text-stone-500 space-x-3 pb-4">
        <Link href="/rules" className="underline underline-offset-2">
          預約規則與個資告知
        </Link>
        <span>·</span>
        <span>
          © {CLINIC.name} {CLINIC.englishName}
        </span>
      </footer>
    </main>
  );
}
