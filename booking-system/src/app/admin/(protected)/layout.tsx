import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaffContext } from "@/lib/auth/staff";
import { PERMISSIONS } from "@/lib/auth/authz";
import { DeerMascot } from "@/components/ui";
import { LogoutButton } from "./logout-button";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getStaffContext();
  if (!ctx) redirect("/admin/login");
  const can = (p: string) => ctx.permissions.has(p);

  const nav = [
    { href: "/admin", label: "今日總覽", show: true },
    { href: "/admin/month", label: "月曆總覽", show: can(PERMISSIONS.APPOINTMENTS_READ) },
    { href: "/admin/booking", label: "代客預約", show: can(PERMISSIONS.APPOINTMENTS_WRITE) },
    { href: "/admin/schedule", label: "排班管理", show: can(PERMISSIONS.SCHEDULE_WRITE) },
    { href: "/admin/patients", label: "病人管理", show: can(PERMISSIONS.PATIENTS_READ) },
    { href: "/admin/restrictions", label: "預約限制", show: can(PERMISSIONS.RESTRICTIONS_READ) },
    { href: "/admin/staff", label: "員工帳號", show: can(PERMISSIONS.STAFF_MANAGE) },
    { href: "/admin/settings", label: "系統設定", show: can(PERMISSIONS.SETTINGS_MANAGE) },
    { href: "/admin/audit", label: "稽核紀錄", show: can(PERMISSIONS.AUDIT_READ) },
  ].filter((n) => n.show);

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-sage-50">
      <header className="bg-white border-b border-sage-100 shadow-sm sticky top-0 z-50 no-print">
        <div className="mx-auto max-w-7xl px-4 py-2.5 flex items-center gap-4">
          <Link href="/admin" className="flex items-center gap-2 font-bold shrink-0 text-sage-700">
            <DeerMascot size={32} />
            <span className="hidden sm:inline">立欣診所預約後台</span>
          </Link>
          <nav className="flex gap-1 overflow-x-auto text-sm flex-1">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="rounded-full px-3 py-1.5 whitespace-nowrap text-ink-700 hover:bg-sage-100 hover:text-sage-700 transition"
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2 shrink-0 text-sm">
            <span className="hidden sm:inline text-ink-500">
              {ctx.user.displayName}（{ctx.user.role.name}）
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5">{children}</main>
    </div>
  );
}
