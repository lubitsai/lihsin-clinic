import { prisma, type Tx } from "./db";
import { getSetting } from "./settings";
import { writeAudit, type AuditActor, SYSTEM_ACTOR } from "./audit";

/**
 * 病人目前是否受預約限制。
 * SUSPENDED（暫時解除）在 suspendedUntil 之前視為不受限，逾期自動恢復生效。
 */
export async function isPatientRestricted(tx: Tx, patientId: string): Promise<boolean> {
  const rows = await tx.bookingRestriction.findMany({
    where: { patientId, status: { in: ["ACTIVE", "SUSPENDED"] } },
  });
  const now = new Date();
  return rows.some((r) => {
    if (r.expiresAt && r.expiresAt <= now) return false; // 已期滿（待 applyRestrictionExpiry 收尾）
    return (
      r.status === "ACTIVE" ||
      (r.status === "SUSPENDED" && (!r.suspendedUntil || r.suspendedUntil <= now))
    );
  });
}

/**
 * 結算已期滿的自動限制：解除限制並把未到次數歸零
 * （官網公告：暫停 3 個月，3 個月後累計歸零）。
 * 呼叫端須已鎖定該病人列，避免與並發預約競態。
 */
export async function applyRestrictionExpiry(tx: Tx, patientId: string): Promise<boolean> {
  const now = new Date();
  const lapsed = await tx.bookingRestriction.findMany({
    where: {
      patientId,
      status: { in: ["ACTIVE", "SUSPENDED"] },
      expiresAt: { not: null, lte: now },
    },
  });
  if (lapsed.length === 0) return false;
  await tx.bookingRestriction.updateMany({
    where: { id: { in: lapsed.map((r) => r.id) } },
    data: { status: "LIFTED", liftedAt: now, liftReason: "暫停期滿，系統自動恢復" },
  });
  await tx.patient.update({ where: { id: patientId }, data: { noShowCount: 0 } });
  await writeAudit(
    SYSTEM_ACTOR,
    "restriction.auto_expire",
    { type: "patient", id: patientId },
    { restrictionIds: lapsed.map((r) => r.id), noShowCountReset: true },
    tx,
  );
  return true;
}

/**
 * 標記未到後檢查是否達到自動限制門檻（未到累計「達」threshold 次即限制，
 * 與官網公告「累計 3 次未到」一致）。已有生效中限制則不重複建立。
 * 限制帶到期日，期滿由 applyRestrictionExpiry 自動恢復並歸零。
 */
export async function maybeAutoRestrict(tx: Tx, patientId: string, noShowCount: number) {
  const [threshold, suspensionDays] = await Promise.all([
    getSetting("booking.no_show_threshold", tx),
    getSetting("booking.no_show_suspension_days", tx),
  ]);
  if (noShowCount < threshold) return null;
  const existing = await tx.bookingRestriction.findFirst({
    where: { patientId, status: { in: ["ACTIVE", "SUSPENDED"] } },
  });
  if (existing) return null;
  const expiresAt =
    suspensionDays > 0 ? new Date(Date.now() + suspensionDays * 86400000) : null;
  const restriction = await tx.bookingRestriction.create({
    data: {
      patientId,
      type: "AUTO_NO_SHOW",
      status: "ACTIVE",
      reason: `未到累計 ${noShowCount} 次（門檻 ${threshold} 次），系統自動暫停線上預約${
        suspensionDays > 0 ? ` ${suspensionDays} 天` : ""
      }`,
      expiresAt,
    },
  });
  await writeAudit(
    SYSTEM_ACTOR,
    "restriction.auto_create",
    { type: "booking_restriction", id: restriction.id },
    { patientId, noShowCount, threshold, expiresAt: expiresAt?.toISOString() ?? null },
    tx,
  );
  return restriction;
}

/** 解除限制（需原因；稽核） */
export async function liftRestriction(
  restrictionId: string,
  actor: AuditActor,
  reason: string,
  suspendedUntil?: Date,
) {
  return prisma.$transaction(async (tx) => {
    const r = await tx.bookingRestriction.update({
      where: { id: restrictionId },
      data: suspendedUntil
        ? { status: "SUSPENDED", suspendedUntil, liftedBy: actor.id, liftReason: reason }
        : { status: "LIFTED", liftedAt: new Date(), liftedBy: actor.id, liftReason: reason },
    });
    await writeAudit(
      actor,
      suspendedUntil ? "restriction.suspend" : "restriction.lift",
      { type: "booking_restriction", id: r.id },
      { patientId: r.patientId, reason, suspendedUntil: suspendedUntil?.toISOString() },
      tx,
    );
    return r;
  });
}

/** 重設病人未到次數（需原因；稽核；不撤銷歷史 no_show_records，只歸零計數） */
export async function resetNoShowCount(patientId: string, actor: AuditActor, reason: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.patient.findUniqueOrThrow({ where: { id: patientId } });
    const p = await tx.patient.update({ where: { id: patientId }, data: { noShowCount: 0 } });
    await writeAudit(
      actor,
      "patient.no_show_reset",
      { type: "patient", id: patientId },
      { from: before.noShowCount, reason },
      tx,
    );
    return p;
  });
}

/** 手動加入限制（需原因；稽核） */
export async function createManualRestriction(
  patientId: string,
  actor: AuditActor,
  reason: string,
) {
  return prisma.$transaction(async (tx) => {
    const r = await tx.bookingRestriction.create({
      data: { patientId, type: "MANUAL", status: "ACTIVE", reason, createdBy: actor.id },
    });
    await writeAudit(
      actor,
      "restriction.manual_create",
      { type: "booking_restriction", id: r.id },
      { patientId, reason },
      tx,
    );
    return r;
  });
}
