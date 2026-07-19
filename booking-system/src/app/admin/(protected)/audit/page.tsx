import Link from "next/link";
import { getStaffContext } from "@/lib/auth/staff";
import { PERMISSIONS, requirePermission } from "@/lib/auth/authz";
import { listAuditLogs } from "@/lib/admin-service";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "稽核紀錄" };

const ACTOR_LABEL: Record<string, string> = { STAFF: "員工", PATIENT: "民眾", SYSTEM: "系統" };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; action?: string }>;
}) {
  requirePermission(await getStaffContext(), PERMISSIONS.AUDIT_READ);
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const rows = await listAuditLogs({ page, action: sp.action });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-forest-700">稽核紀錄</h1>
      <form action="/admin/audit" method="get" className="flex gap-2 max-w-md">
        <input name="action" defaultValue={sp.action ?? ""} placeholder="依動作篩選，如 restriction、schedule" className="input" />
        <button className="btn-secondary !py-2 shrink-0">篩選</button>
      </form>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-stone-500">
              <th className="py-1.5 pr-3">時間（台灣）</th>
              <th className="pr-3">操作者</th>
              <th className="pr-3">動作</th>
              <th className="pr-3">對象</th>
              <th>詳細</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cream-200 align-top">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2 pr-3 font-mono whitespace-nowrap">
                  {new Date(r.createdAt.getTime() + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ")}
                </td>
                <td className="pr-3">
                  {ACTOR_LABEL[r.actorType]}
                  {r.actorName ? `｜${r.actorName}` : ""}
                </td>
                <td className="pr-3 font-mono">{r.action}</td>
                <td className="pr-3 text-stone-500">
                  {r.targetType ? `${r.targetType}:${r.targetId?.slice(0, 8)}…` : "—"}
                </td>
                <td className="text-stone-500 break-all max-w-md">
                  {r.detail ? JSON.stringify(r.detail).slice(0, 200) : "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-stone-500">
                  沒有符合的紀錄。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <div className="flex gap-2">
        {page > 1 && (
          <Link href={`/admin/audit?page=${page - 1}&action=${sp.action ?? ""}`} className="btn-secondary !py-2">
            ← 較新
          </Link>
        )}
        {rows.length === 50 && (
          <Link href={`/admin/audit?page=${page + 1}&action=${sp.action ?? ""}`} className="btn-secondary !py-2">
            較舊 →
          </Link>
        )}
      </div>
    </div>
  );
}
