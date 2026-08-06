/**
 * 把官網門診時間表套用到這套系統的班表（官網為主）。
 *
 * 何時執行：官網門診時間表有異動、且 `prisma/schedule.json` 已由
 * `internal/tools/sync_schedule.py` 重新產生並部署之後。
 *
 *     npx tsx scripts/sync-schedule.ts                   # 實際套用
 *     npx tsx scripts/sync-schedule.ts --dry-run         # 只看會改什麼，不寫入
 *     npx tsx scripts/sync-schedule.ts --cancel-affected # 連同受影響預約一併取消並通知
 *
 * 只會動「官網說了算」的部分：週班表，以及本工具自己建立的日期例外
 * （createdBy = website-sync）。櫃檯在後台輸入的停診、代診、加開名額一律不動。
 *
 * 受影響預約（院長 2026-08-06 裁示 (a)：比照單日例外）：
 * 新班表會讓某些既有預約失去時段時，**預設整批不寫入**，先列出名單。
 * 櫃檯到後台逐筆改期後再跑一次，或確認要一併取消時加 --cancel-affected。
 */
import { PrismaClient } from "@prisma/client";
import { applySchedule, loadScheduleSource, type ApplyResult } from "../src/lib/schedule-source";
import { dbToDate, todayStr } from "../src/lib/tw-time";

const prisma = new PrismaClient();

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const cancelAffected = process.argv.includes("--cancel-affected");
  const source = loadScheduleSource();
  const opts = { cancelAffected: cancelAffected || dryRun };

  if (dryRun) {
    // 在交易內套用後回滾：拿到真實結果又不留下任何變更。
    // 試算一律以「已授權取消」跑，才看得到完整的變更內容與會被取消的名單。
    let preview: ApplyResult | undefined;
    await prisma
      .$transaction(
        async (tx) => {
          preview = await applySchedule(tx as unknown as PrismaClient, source, todayStr(), opts);
          throw new Error("__ROLLBACK__");
        },
        { timeout: 60000 },
      )
      .catch((e) => {
        if (!(e instanceof Error) || e.message !== "__ROLLBACK__") throw e;
      });
    report(preview!, true);
    return;
  }

  // 班表變更與受影響預約的取消放在同一交易：中途失敗整批回滾，
  // 不會留下「病人被取消了、班表卻沒改」的半套狀態。
  const result = await prisma.$transaction(
    async (tx) => applySchedule(tx as unknown as PrismaClient, source, todayStr(), opts),
    { timeout: 60000 },
  );
  report(result, false);
  if (!result.applied) process.exitCode = 2;
}

function report(r: ApplyResult, dryRun: boolean) {
  const prefix = dryRun ? "（試算，未寫入）" : "";

  if (!r.applied) {
    console.log("⛔ 班表未同步：以下預約會落在新班表的看診時間之外\n");
    printAffected(r.affected);
    console.log(
      "\n處理方式（擇一）：\n" +
        "  1. 到後台「預約總覽」把上列預約逐筆改期，再跑一次本指令；\n" +
        "  2. 確認要一併取消並通知家長：npx tsx scripts/sync-schedule.ts --cancel-affected",
    );
    return;
  }

  console.log(`${prefix}班表同步完成：`);
  console.log(`  週班表：新增 ${r.created}、更新 ${r.updated}、移除 ${r.removed}`);
  console.log(`  單日例外：套用 ${r.exceptionsApplied} 筆`);
  if (r.affected.length > 0) {
    console.log(
      `  ${dryRun ? "會" : "已"}以「診所取消」處理 ${r.affected.length} 筆受影響預約` +
        `${dryRun ? "" : "並排入通知"}：`,
    );
    printAffected(r.affected, "    ");
  }
  for (const w of r.warnings) console.log(`  ⚠️ ${w}`);
}

function printAffected(
  affected: ApplyResult["affected"],
  indent = "  ",
) {
  for (const a of affected) {
    console.log(
      `${indent}${dbToDate(a.appointmentDate)} ${a.startTime}　${a.patient.name}　` +
        `${a.patient.phone}　${a.bookingNumber}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
