import { prisma } from "@/lib/db";
import { getStaffContext } from "@/lib/auth/staff";
import { PERMISSIONS, requirePermission } from "@/lib/auth/authz";
import { getSetting } from "@/lib/settings";
import { getHolidayCoverage, isCoverageSufficient } from "@/lib/holidays";
import { addDays, todayStr } from "@/lib/tw-time";
import { SettingsManager } from "./settings-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "系統設定" };

export default async function SettingsPage() {
  requirePermission(await getStaffContext(), PERMISSIONS.SETTINGS_MANAGE);
  const [clinicTypes, doctors] = await Promise.all([
    prisma.clinicType.findMany({
      orderBy: { displayOrder: "asc" },
      include: { doctors: true, windows: { orderBy: [{ weekday: "asc" }, { startTime: "asc" }] } },
    }),
    prisma.doctor.findMany({ orderBy: { displayOrder: "asc" } }),
  ]);
  const settings = {
    openDays: await getSetting("booking.open_days"),
    openTime: await getSetting("booking.open_time"),
    sameDayCutoff: await getSetting("booking.same_day_cutoff_minutes"),
    activeMax: await getSetting("booking.active_max"),
    noShowThreshold: await getSetting("booking.no_show_threshold"),
    noShowSuspensionDays: await getSetting("booking.no_show_suspension_days"),
    cancelCutoff: await getSetting("booking.cancel_cutoff_minutes"),
    checkinGrace: await getSetting("booking.checkin_grace_minutes"),
    allowSameDay: await getSetting("booking.allow_same_day"),
    sameDayReminder: await getSetting("notify.same_day_reminder"),
    dayBeforeTime: await getSetting("notify.day_before_time"),
    sameDayTime: await getSetting("notify.same_day_time"),
    idleMinutes: await getSetting("security.staff_idle_minutes"),
  };

  const coverage = await getHolidayCoverage();
  const lastOpenDate = addDays(todayStr(), settings.openDays - 1);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-sage-700">系統設定</h1>
      <SettingsManager
        settings={settings}
        clinicTypes={clinicTypes.map((t) => ({
          id: t.id,
          code: t.code,
          name: t.name,
          description: t.description ?? "",
          notice: t.notice ?? "",
          isActive: t.isActive,
          requiresReview: t.requiresReview,
          notifyLine: t.notifyLine,
          skipOnPublicHoliday: t.skipOnPublicHoliday,
          minAgeMonths: t.minAgeMonths,
          maxAgeMonths: t.maxAgeMonths,
          allowedWeekdays: t.allowedWeekdays,
          allowedSessions: t.allowedSessions,
          windows: t.windows.map((w) => ({
            weekday: w.weekday,
            startTime: w.startTime,
            endTime: w.endTime,
          })),
          doctorIds: t.doctors.map((d) => d.doctorId),
          color: t.color,
          icon: t.icon,
        }))}
        doctors={doctors.map((d) => ({
          id: d.id,
          name: d.name,
          title: d.title ?? "",
          isActive: d.isActive,
          displayOrder: d.displayOrder,
        }))}
        lineConfigured={!!process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN}
        smsProvider={process.env.SMS_PROVIDER ?? "console"}
        holidays={{
          ...coverage,
          sufficient: isCoverageSufficient(coverage, lastOpenDate),
          lastOpenDate,
        }}
      />
    </div>
  );
}
