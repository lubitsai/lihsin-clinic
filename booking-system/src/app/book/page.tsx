import Link from "next/link";
import { fetchClinicTypes, fetchPortalStatus } from "@/app/actions/portal";
import { isLineLoginConfigured } from "@/lib/line";
import { DeerMascot } from "@/components/ui";
import { BookingWizard } from "./wizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "線上預約" };

export default async function BookPage() {
  const [clinicTypes, portalStatus] = await Promise.all([fetchClinicTypes(), fetchPortalStatus()]);
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <header className="flex items-center justify-between mb-4">
        <Link href="/" className="flex items-center gap-2 text-forest-700">
          <DeerMascot size={40} />
          <span className="font-bold text-xl">立欣診所線上預約</span>
        </Link>
        {portalStatus.loggedIn && portalStatus.viaLine && (
          <span className="text-sm rounded-full bg-forest-500/10 text-forest-700 px-3 py-1">LINE 已登入</span>
        )}
      </header>
      <BookingWizard
        clinicTypes={clinicTypes}
        lineConfigured={isLineLoginConfigured()}
        viaLine={portalStatus.loggedIn && portalStatus.viaLine}
      />
    </main>
  );
}
