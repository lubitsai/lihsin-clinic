import Link from "next/link";
import { prisma } from "@/lib/db";
import { todayStr, addDays, formatDateTw } from "@/lib/tw-time";
import { getDayScheduleBlocks, SESSION_LABEL } from "@/lib/schedule";
import { dateToDb } from "@/lib/tw-time";
import { CLINIC } from "@/lib/clinic-info";
import { WALK_IN_REGISTRATION } from "@/lib/clinic-notes";
import { Card, Alert } from "@/components/ui";
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
  // 醫師排序依 displayOrder（院長在前）；班表查出來的順序不保證，不排會忽前忽後
  const doctorRank = new Map(doctors.map((d, i) => [d.id, i]));
  const todaySessions = [...new Set(blocks.map((b) => b.session))];

  /**
   * 同一診次可能不只一段看診時間：雙診（週一晚診、週日早診）兩位醫師時間相同，
   * 但當日若只對其中一位套用「特殊時間」例外，兩人的時間就會不一樣。
   * 依時間分組後逐段顯示，才不會拿其中一位的時間去標另一位。
   */
  function sessionRows(session: (typeof todaySessions)[number]) {
    const groups = new Map<string, Set<string>>();
    for (const b of blocks.filter((x) => x.session === session)) {
      const range = `${b.startTime}–${b.endTime}`;
      if (!groups.has(range)) groups.set(range, new Set());
      groups.get(range)!.add(b.doctorId);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([range, ids]) => ({
        range,
        names: [...ids]
          .sort((a, b) => (doctorRank.get(a) ?? 0) - (doctorRank.get(b) ?? 0))
          .map((id) => doctorName.get(id))
          .filter(Boolean)
          .join("、"),
      }));
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-sage-50">
      <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      {/*
        封面橫幅（院長 2026-08-07 提供）。圖內已有診所名、英文名與標語，
        故不再重複輸出頁首文字；H1 改為視覺隱藏但螢幕閱讀器讀得到。
        width/height 必填以免版面跳動（CLS）；不用 next/image，
        standalone 產物的圖片最佳化需要額外相依，這張圖已先壓好、沒必要。
      */}
      <header>
        <h1 className="sr-only">
          {CLINIC.name}線上預約（{CLINIC.englishName}）
        </h1>
        <picture>
          <source type="image/webp" media="(max-width: 767px)" srcSet="/cover-768.webp" />
          <source type="image/webp" srcSet="/cover.webp" />
          <img
            src="/cover.jpg"
            width={1600}
            height={840}
            alt={`${CLINIC.name} ${CLINIC.englishName}：安心預約，溫暖照護`}
            className="w-full rounded-2xl shadow-md"
            fetchPriority="high"
          />
        </picture>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          href="/book"
          className="rounded-full bg-gradient-to-br from-sage-500 to-sage-700 text-white text-center py-5 text-2xl font-bold shadow-lg transition hover:shadow-xl active:scale-[0.98]"
        >
          🗓️ 立即預約
        </Link>
        <Link
          href="/my"
          className="rounded-full bg-gradient-to-br from-wood-400 to-wood-600 text-white text-center py-5 text-2xl font-bold shadow-lg transition hover:shadow-xl active:scale-[0.98]"
        >
          🔍 查詢／取消預約
        </Link>
      </div>

      <Card>
        <h2 className="text-lg font-bold text-sage-700 mb-2">今日門診（{formatDateTw(today)}）</h2>
        {todaySessions.length === 0 ? (
          <p className="text-ink-700">今日休診。如有需要請致電診所詢問。</p>
        ) : (
          <ul className="space-y-1">
            {(["MORNING", "AFTERNOON", "EVENING"] as const)
              .filter((s) => todaySessions.includes(s))
              .flatMap((s) =>
                sessionRows(s).map((row, i) => (
                  <li key={`${s}-${row.range}`} className="flex flex-wrap gap-x-3 text-ink-900">
                    {/* 同一診次拆成多段時，診別只標在第一行 */}
                    <span className="font-medium text-wood-700 w-12">
                      {i === 0 ? SESSION_LABEL[s] : ""}
                    </span>
                    <span>
                      {row.range}｜{row.names}醫師
                    </span>
                  </li>
                )),
              )}
          </ul>
        )}
      </Card>

      {/* 接在今日門診之後：看完今天有哪幾診，下一個問題就是幾點可以到櫃檯抽號 */}
      <Card className="space-y-1">
        <h2 className="text-lg font-bold text-sage-700">🕗 {WALK_IN_REGISTRATION.title}</h2>
        <p className="text-lg sm:text-xl font-bold text-wood-700">{WALK_IN_REGISTRATION.times}</p>
        <p className="text-ink-700 text-sm leading-relaxed">{WALK_IN_REGISTRATION.note}</p>
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

      {/*
        非急診定位與 119 但書（合規紅線 internal/00 §4-5）只放在 /rules
        ——院長 2026-08-05 裁示。該頁由頁尾與預約流程的同意事項連出，
        兩處都連得到，故本頁不重複。移除前請先確認 /rules 仍留有該段。
      */}
      <Alert tone="info">
        線上預約為看診時段登記，<strong>不等於實際看診號碼</strong>，現場依報到順序與醫師看診狀況候診，敬請見諒。
      </Alert>

      <Card className="space-y-2">
        <h2 className="text-lg font-bold text-sage-700">聯絡立欣診所</h2>
        <p>
          📞 電話：
          <a href={CLINIC.phoneHref} className="text-sage-600 font-bold underline underline-offset-2">
            {CLINIC.phone}
          </a>
        </p>
        <p>📍 地址：{CLINIC.address}</p>
        <p>
          🌐 官方網站：
          <a href={CLINIC.website} className="text-sage-600 underline underline-offset-2" rel="noopener">
            lhpedclinic.com.tw
          </a>
        </p>
        {isLineLoginConfigured() && (
          <p>
            💬 LINE 官方帳號：
            <a href={CLINIC.lineOfficialUrl} className="text-sage-600 underline underline-offset-2" rel="noopener">
              加入好友接收看診提醒
            </a>
          </p>
        )}
      </Card>

        <footer className="text-center text-sm text-ink-500 space-x-3 pb-4">
        <Link href="/rules" className="underline underline-offset-2">
          預約規則與個資告知
        </Link>
        <span>·</span>
        <span>
          © {CLINIC.name} {CLINIC.englishName}
        </span>
        </footer>
      </div>
    </main>
  );
}
