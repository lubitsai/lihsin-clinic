import Link from "next/link";
import {
  fetchPortalStatus,
  fetchMyAppointments,
  fetchMyBindings,
  fetchClinicTypes,
} from "@/app/actions/portal";
import { isLineLoginConfigured, isLineDevLoginEnabled } from "@/lib/line";
import { CLINIC } from "@/lib/clinic-info";
import { DeerMascot, Alert } from "@/components/ui";
import { MyAppointments } from "./my-appointments";
import { LineBindings } from "./line-bindings";

export const dynamic = "force-dynamic";
export const metadata = { title: "查詢我的預約" };

export default async function MyPage() {
  const status = await fetchPortalStatus();
  const lineConfigured = isLineLoginConfigured();

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-sage-50">
      <div className="mx-auto max-w-2xl px-4 py-6 space-y-5">
      <header className="flex items-center gap-2">
        <Link href="/" className="flex items-center gap-2 text-sage-700">
          <DeerMascot size={40} />
          <span className="font-bold text-xl">查詢我的預約</span>
        </Link>
      </header>

      {status.loggedIn ? (
        <LoggedIn />
      ) : (
        <div className="space-y-5">
          <div className="rounded-card bg-white border border-sage-200 p-5 text-center space-y-3">
            <p className="text-ink-900">查詢與取消預約請先以 LINE 登入：</p>
            {lineConfigured ? (
              <a
                href="/api/line/login?next=/my"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#06C755] px-6 py-3 font-bold text-white"
              >
                以 LINE 登入
              </a>
            ) : (
              <Alert tone="warn">LINE 登入目前無法使用，請致電 {CLINIC.phone}。</Alert>
            )}
            {isLineDevLoginEnabled() && (
              <a href="/api/line/dev-login?next=/my" className="btn-secondary inline-block">
                測試登入（示範環境專用）
              </a>
            )}
          </div>
          <Alert tone="info">
            沒有使用 LINE，或想取消預約卻登入不了，請致電 {CLINIC.phone} 由櫃檯協助處理。
          </Alert>
        </div>
      )}
    </div>
    </main>
  );
}

async function LoggedIn() {
  const [result, clinicTypes, bindings] = await Promise.all([
    fetchMyAppointments(),
    fetchClinicTypes(),
    fetchMyBindings(),
  ]);
  return (
    <div className="space-y-5">
      {bindings.ok && <LineBindings initial={bindings.data ?? []} />}
      {result.ok ? (
        <MyAppointments initial={result.data ?? []} clinicTypes={clinicTypes} />
      ) : (
        <p className="text-ink-700">尚無綁定成員的預約紀錄。綁定家庭成員後即可在此管理預約。</p>
      )}
    </div>
  );
}
