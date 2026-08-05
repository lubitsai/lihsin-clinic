import Link from "next/link";
import { fetchClinicTypes, fetchPortalStatus } from "@/app/actions/portal";
import { isLineLoginConfigured } from "@/lib/line";
import { getSetting } from "@/lib/settings";
import { DeerMascot } from "@/components/ui";
import { BookingWizard } from "./wizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "線上預約" };

export default async function BookPage() {
  const [clinicTypes, portalStatus, checkinGraceMinutes] = await Promise.all([
    fetchClinicTypes(),
    fetchPortalStatus(),
    getSetting("booking.checkin_grace_minutes"),
  ]);
  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-sage-50">
      <div className="mx-auto max-w-2xl px-4 py-6">
      <header className="flex items-center justify-between mb-4">
        <Link href="/" className="flex items-center gap-2 text-sage-700">
          <DeerMascot size={40} />
          <span className="font-bold text-xl">立欣診所線上預約</span>
        </Link>
        {portalStatus.loggedIn && portalStatus.viaLine && (
          <span className="text-sm rounded-full bg-sage-500/10 text-sage-700 px-3 py-1">LINE 已登入</span>
        )}
      </header>
      <BookingWizard
        clinicTypes={clinicTypes}
        lineConfigured={isLineLoginConfigured()}
        viaLine={portalStatus.loggedIn && portalStatus.viaLine}
        checkinGraceMinutes={checkinGraceMinutes}
      />
    </div>
    </main>
  );
}
