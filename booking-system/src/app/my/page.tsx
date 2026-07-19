import Link from "next/link";
import { fetchPortalStatus, fetchMyAppointments, fetchClinicTypes } from "@/app/actions/portal";
import { isLineLoginConfigured } from "@/lib/line";
import { DeerMascot } from "@/components/ui";
import { MyAppointments } from "./my-appointments";
import { IdentityLoginForm } from "./identity-login";

export const dynamic = "force-dynamic";
export const metadata = { title: "查詢我的預約" };

export default async function MyPage() {
  const status = await fetchPortalStatus();
  const lineConfigured = isLineLoginConfigured();

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 space-y-5">
      <header className="flex items-center gap-2">
        <Link href="/" className="flex items-center gap-2 text-forest-700">
          <DeerMascot size={40} />
          <span className="font-bold text-xl">查詢我的預約</span>
        </Link>
      </header>

      {status.loggedIn ? (
        <LoggedIn />
      ) : (
        <div className="space-y-5">
          {lineConfigured && (
            <div className="rounded-card bg-white border border-cream-200 p-5 text-center space-y-3">
              <p className="text-stone-700">已綁定 LINE 的家長可直接登入：</p>
              <a
                href="/api/line/login?next=/my"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#06C755] px-6 py-3 font-bold text-white"
              >
                以 LINE 登入
              </a>
            </div>
          )}
          <IdentityLoginForm />
        </div>
      )}
    </main>
  );
}

async function LoggedIn() {
  const [result, clinicTypes] = await Promise.all([fetchMyAppointments(), fetchClinicTypes()]);
  if (!result.ok) {
    return <p className="text-stone-600">{result.message}</p>;
  }
  return <MyAppointments initial={result.data ?? []} clinicTypes={clinicTypes} />;
}
