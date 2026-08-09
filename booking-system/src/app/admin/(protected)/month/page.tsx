/**
 * 月曆總覽：一次看完整個月每天的預約名單。
 *
 * 為什麼要有這頁：今日總覽一次只看一天，櫃檯想知道「這個月哪幾天特別滿」
 * 或「下週三有誰」得一天一天翻。院長 2026-08-09 指定要月曆式呈現。
 *
 * 證件號一律遮罩顯示（僅末碼），與病歷頁一致——月曆是整月上百筆一次攤開，
 * 更不該把完整證件號放在畫面上。要看完整資料點進當日總覽。
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaffContext } from "@/lib/auth/staff";
import { PERMISSIONS } from "@/lib/auth/authz";
import { getMonthAppointments } from "@/lib/admin-service";
import { prisma } from "@/lib/db";
import { todayStr } from "@/lib/tw-time";
import { MonthBoard } from "./month-board";

export const dynamic = "force-dynamic";
export const metadata = { title: "月曆總覽" };

/** 該月第一天／最後一天（皆為台灣日期字串） */
function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}`, days: last };
}

export default async function MonthPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; doctorId?: string; clinicTypeId?: string }>;
}) {
  const ctx = await getStaffContext();
  if (!ctx) redirect("/admin/login");
  if (!ctx.permissions.has(PERMISSIONS.APPOINTMENTS_READ)) {
    return (
      <p className="text-center py-12 text-ink-700">
        您的帳號沒有檢視預約總覽的權限。
      </p>
    );
  }

  const sp = await searchParams;
  const today = todayStr();
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : today.slice(0, 7);
  const { start, end, days } = monthRange(month);

  const [byDate, doctors, clinicTypes] = await Promise.all([
    getMonthAppointments(start, end, {
      doctorId: sp.doctorId || undefined,
      clinicTypeId: sp.clinicTypeId || undefined,
    }),
    prisma.doctor.findMany({ where: { isActive: true }, orderBy: { displayOrder: "asc" } }),
    prisma.clinicType.findMany({ where: { isActive: true }, orderBy: { displayOrder: "asc" } }),
  ]);

  // 序列化成畫面要的最小形狀（Date 不能直接進 client component）
  const dayList = Array.from({ length: days }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, "0")}`;
    const rows = byDate.get(date) ?? [];
    return {
      date,
      weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
      appointments: rows.map((a) => ({
        id: a.id,
        startTime: a.startTime,
        status: a.status,
        patientName: a.patient.name,
        idMasked: a.patient.idNumberMasked,
        doctorName: a.doctor.name,
        doctorColor: a.doctor.color ?? "#7C9A6E",
        clinicTypeName: a.clinicType.name,
        clinicTypeColor: a.clinicType.color ?? "#7C9A6E",
        companions: a._count.companions,
      })),
    };
  });

  const [y, m] = month.split("-").map(Number);
  const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 no-print">
        <h1 className="text-xl font-bold text-sage-700">
          {y} 年 {m} 月
          <span className="ml-2 text-sm font-normal text-ink-500">
            共 {dayList.reduce((n, d) => n + d.appointments.length, 0)} 筆
          </span>
        </h1>
        <span className="flex-1" />
        <MonthNav month={prev} params={sp} label="← 上個月" />
        <MonthNav month={today.slice(0, 7)} params={sp} label="本月" />
        <MonthNav month={next} params={sp} label="下個月 →" />
      </div>

      <form className="flex flex-wrap gap-2 items-center no-print" method="get">
        <input type="hidden" name="month" value={month} />
        <select name="doctorId" defaultValue={sp.doctorId ?? ""} className="input !w-auto">
          <option value="">全部醫師</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}醫師
            </option>
          ))}
        </select>
        <select name="clinicTypeId" defaultValue={sp.clinicTypeId ?? ""} className="input !w-auto">
          <option value="">全部門診</option>
          {clinicTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button className="btn-secondary !px-3 !py-2">篩選</button>
      </form>

      <MonthBoard days={dayList} today={today} />
    </div>
  );
}

function MonthNav({
  month,
  params,
  label,
}: {
  month: string;
  params: { doctorId?: string; clinicTypeId?: string };
  label: string;
}) {
  const q = new URLSearchParams({ month });
  if (params.doctorId) q.set("doctorId", params.doctorId);
  if (params.clinicTypeId) q.set("clinicTypeId", params.clinicTypeId);
  return (
    <Link href={`/admin/month?${q}`} className="btn-secondary !px-3 !py-1.5 text-sm">
      {label}
    </Link>
  );
}
