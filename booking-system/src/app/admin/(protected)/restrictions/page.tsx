import Link from "next/link";
import { getStaffContext } from "@/lib/auth/staff";
import { PERMISSIONS, requirePermission, hasPermission } from "@/lib/auth/authz";
import { listRestrictions } from "@/lib/admin-service";
import { Card } from "@/components/ui";
import { RestrictionListControls } from "./restriction-controls";

export const dynamic = "force-dynamic";
export const metadata = { title: "預約限制名單" };

export default async function RestrictionsPage() {
  const ctx = requirePermission(await getStaffContext(), PERMISSIONS.RESTRICTIONS_READ);
  const rows = await listRestrictions();
  const canManage = hasPermission(ctx, PERMISSIONS.RESTRICTIONS_MANAGE);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-forest-700">預約限制名單</h1>
      <p className="text-stone-600 text-sm">
        未到累計超過門檻自動加入；解除／暫時解除／重設由管理員於病人頁或此處操作，均需原因並留稽核。
      </p>
      <Card>
        {rows.length === 0 ? (
          <p className="text-stone-500">目前沒有限制紀錄。</p>
        ) : (
          <ul className="divide-y divide-cream-200">
            {rows.map((r) => (
              <li key={r.id} className="py-2.5 flex flex-wrap items-center gap-3">
                <span
                  className={`rounded px-2 py-0.5 text-sm font-bold ${
                    r.status === "ACTIVE"
                      ? "bg-red-100 text-red-800"
                      : r.status === "SUSPENDED"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-stone-100 text-stone-500"
                  }`}
                >
                  {r.status === "ACTIVE" ? "生效中" : r.status === "SUSPENDED" ? "暫時解除" : "已解除"}
                </span>
                <Link href={`/admin/patients/${r.patientId}`} className="font-bold text-forest-700 underline underline-offset-2">
                  {r.patient.name}
                </Link>
                <span className="text-stone-600">{r.patient.idNumberMasked}</span>
                <span className="text-stone-500 text-sm">
                  未到 {r.patient.noShowCount} 次｜{r.type === "AUTO_NO_SHOW" ? "自動" : "人工"}｜
                  {r.createdAt.toISOString().slice(0, 10)}
                </span>
                <span className="text-stone-500 text-sm">{r.reason}</span>
                {canManage && ["ACTIVE", "SUSPENDED"].includes(r.status) && (
                  <RestrictionListControls restrictionId={r.id} patientId={r.patientId} noShowCount={r.patient.noShowCount} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
