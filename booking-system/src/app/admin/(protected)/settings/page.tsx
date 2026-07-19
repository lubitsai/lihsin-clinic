import { prisma } from "@/lib/db";
import { getStaffContext } from "@/lib/auth/staff";
import { PERMISSIONS, requirePermission } from "@/lib/auth/authz";
import { getSetting } from "@/lib/settings";
import { SettingsManager } from "./settings-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "系統設定" };

export default async function SettingsPage() {
  requirePermission(await getStaffContext(), PERMISSIONS.SETTINGS_MANAGE);
  const [clinicTypes, doctors] = await Promise.all([
    prisma.clinicType.findMany({ orderBy: { displayOrder: "asc" }, include: { doctors: true } }),
    prisma.doctor.findMany({ orderBy: { displayOrder: "asc" } }),
  ]);
  const settings = {
    openDays: await getSetting("booking.open_days"),
    sameDayCutoff: await getSetting("booking.same_day_cutoff_minutes"),
    windowDays: await getSetting("booking.window_days"),
    windowMax: await getSetting("booking.window_max"),
    noShowThreshold: await getSetting("booking.no_show_threshold"),
    cancelCutoff: await getSetting("booking.cancel_cutoff_minutes"),
    allowSameDay: await getSetting("booking.allow_same_day"),
    sameDayReminder: await getSetting("notify.same_day_reminder"),
    dayBeforeTime: await getSetting("notify.day_before_time"),
    sameDayTime: await getSetting("notify.same_day_time"),
    idleMinutes: await getSetting("security.staff_idle_minutes"),
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-forest-700">系統設定</h1>
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
          minAgeMonths: t.minAgeMonths,
          maxAgeMonths: t.maxAgeMonths,
          allowedWeekdays: t.allowedWeekdays,
          allowedSessions: t.allowedSessions,
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
      />
    </div>
  );
}
