import { prisma } from "@/lib/db";
import { getStaffContext } from "@/lib/auth/staff";
import { PERMISSIONS, requirePermission } from "@/lib/auth/authz";
import { listStaffUsers } from "@/lib/admin-service";
import { StaffManager } from "./staff-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "員工帳號" };

export default async function StaffPage() {
  const ctx = requirePermission(await getStaffContext(), PERMISSIONS.STAFF_MANAGE);
  const [users, doctors] = await Promise.all([
    listStaffUsers(),
    prisma.doctor.findMany({ where: { isActive: true }, orderBy: { displayOrder: "asc" } }),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-forest-700">員工帳號與權限</h1>
      <StaffManager
        users={users.map((u) => ({
          id: u.id,
          username: u.username,
          displayName: u.displayName,
          roleCode: u.role.code as "ADMIN" | "STAFF" | "DOCTOR_READONLY",
          roleName: u.role.name,
          doctorId: u.doctorId,
          doctorName: u.doctor?.name ?? null,
          isActive: u.isActive,
          totpEnabled: u.totpEnabled,
          lastLoginAt: u.lastLoginAt?.toISOString().slice(0, 16).replace("T", " ") ?? null,
        }))}
        doctors={doctors.map((d) => ({ id: d.id, name: d.name }))}
        selfId={ctx.user.id}
        selfTotpEnabled={ctx.user.totpEnabled}
      />
    </div>
  );
}
