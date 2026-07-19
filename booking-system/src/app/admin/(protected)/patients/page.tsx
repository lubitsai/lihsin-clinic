import Link from "next/link";
import { getStaffContext } from "@/lib/auth/staff";
import { PERMISSIONS, requirePermission, hasPermission } from "@/lib/auth/authz";
import { searchPatients, findPossibleDuplicates } from "@/lib/admin-service";
import { maskPhone } from "@/lib/masking";
import { dbToDate } from "@/lib/tw-time";
import { Card } from "@/components/ui";
import { MergeButton } from "./merge-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "病人管理" };

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = requirePermission(await getStaffContext(), PERMISSIONS.PATIENTS_READ);
  const { q } = await searchParams;
  const canMerge = hasPermission(ctx, PERMISSIONS.PATIENTS_MERGE);
  const [patients, duplicates] = await Promise.all([
    q ? searchPatients(q) : Promise.resolve([]),
    canMerge ? findPossibleDuplicates() : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-forest-700">病人管理</h1>
      <form action="/admin/patients" method="get" className="flex gap-2 max-w-lg">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="搜尋姓名／電話／證件末碼"
          className="input"
        />
        <button className="btn-primary !py-2 shrink-0">搜尋</button>
      </form>

      {q && (
        <Card>
          {patients.length === 0 ? (
            <p className="text-stone-500">查無符合的病人。</p>
          ) : (
            <ul className="divide-y divide-cream-200">
              {patients.map((p) => (
                <li key={p.id} className="py-2.5 flex flex-wrap items-center gap-3">
                  <Link href={`/admin/patients/${p.id}`} className="font-bold text-forest-700 underline underline-offset-2">
                    {p.name}
                  </Link>
                  <span className="text-stone-600">{p.idNumberMasked}</span>
                  <span className="text-stone-600">{maskPhone(p.phone)}</span>
                  <span className="text-stone-500 text-sm">生日 {dbToDate(p.birthDate)}</span>
                  {p.noShowCount > 0 && (
                    <span className="text-persimmon-600 text-sm font-medium">未到 {p.noShowCount} 次</span>
                  )}
                  <Link href={`/admin/booking?patient=${p.id}`} className="ml-auto qbtn bg-forest-600 text-white">
                    代約
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {canMerge && duplicates.length > 0 && (
        <Card className="space-y-2">
          <h2 className="font-bold text-persimmon-600">⚠️ 可能重複的病歷（僅管理員可合併）</h2>
          <ul className="divide-y divide-cream-200">
            {duplicates.map((d, i) => (
              <li key={i} className="py-2.5 flex flex-wrap items-center gap-3">
                <span>
                  <Link href={`/admin/patients/${d.a.id}`} className="font-bold underline underline-offset-2">
                    {d.a.name}
                  </Link>{" "}
                  （{d.a.idNumberMasked}）
                </span>
                <span className="text-stone-400">⇄</span>
                <span>
                  <Link href={`/admin/patients/${d.b.id}`} className="font-bold underline underline-offset-2">
                    {d.b.name}
                  </Link>{" "}
                  （{d.b.idNumberMasked}）
                </span>
                <span className="text-sm text-stone-500">
                  {d.reason === "same_name_birth" ? "同姓名＋同生日" : "同電話＋同生日"}
                </span>
                <MergeButton keepId={d.a.id} mergeId={d.b.id} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
