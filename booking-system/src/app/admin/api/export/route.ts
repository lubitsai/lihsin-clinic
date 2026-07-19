import { NextRequest, NextResponse } from "next/server";
import { getStaffContext } from "@/lib/auth/staff";
import { PERMISSIONS } from "@/lib/auth/authz";
import { getDayAppointments } from "@/lib/admin-service";
import { STATUS_META, VISIT_TYPE_LABEL, SOURCE_LABEL } from "@/lib/status-labels";
import { writeAudit } from "@/lib/audit";

/** 匯出當日預約名單 CSV（需登入＋讀取權限；匯出行為留稽核） */
export async function GET(req: NextRequest) {
  const ctx = await getStaffContext();
  if (!ctx || !ctx.permissions.has(PERMISSIONS.APPOINTMENTS_READ)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }
  const rows = await getDayAppointments(date);
  await writeAudit(
    { type: "STAFF", id: ctx.user.id, name: ctx.user.displayName },
    "appointments.export_csv",
    undefined,
    { date, count: rows.length },
  );
  const esc = (s: string) => `"${s.replaceAll('"', '""')}"`;
  const header = ["時間", "病人姓名", "證件號(遮罩)", "電話", "醫師", "門診", "初複診", "狀態", "來源", "預約編號", "備註"];
  const lines = rows.map((a) =>
    [
      a.startTime,
      a.patient.name,
      a.patient.idNumberMasked, // 匯出檔一律遮罩，避免完整證件號外流
      a.patient.phone,
      a.doctor.name,
      a.clinicType.name,
      a.visitType ? VISIT_TYPE_LABEL[a.visitType] : "",
      STATUS_META[a.status].label,
      SOURCE_LABEL[a.source] ?? a.source,
      a.bookingNumber,
      a.patientNote ?? "",
    ]
      .map(esc)
      .join(","),
  );
  const csv = "﻿" + [header.map(esc).join(","), ...lines].join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lihsin-appointments-${date}.csv"`,
    },
  });
}
