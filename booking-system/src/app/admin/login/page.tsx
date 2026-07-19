import { redirect } from "next/navigation";
import { getStaffContext } from "@/lib/auth/staff";
import { DeerMascot } from "@/components/ui";
import { StaffLoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "員工登入" };

export default async function AdminLoginPage() {
  const ctx = await getStaffContext();
  if (ctx) redirect("/admin");
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-block">
            <DeerMascot size={64} />
          </div>
          <h1 className="text-2xl font-bold text-forest-700 mt-2">立欣診所預約後台</h1>
          <p className="text-stone-500 text-sm mt-1">員工專用，操作皆有紀錄</p>
        </div>
        <StaffLoginForm />
      </div>
    </main>
  );
}
