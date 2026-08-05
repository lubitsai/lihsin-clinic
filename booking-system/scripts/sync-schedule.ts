/**
 * 把官網門診時間表套用到這套系統的班表（官網為主）。
 *
 * 何時執行：官網門診時間表有異動、且 `prisma/schedule.json` 已由
 * `internal/tools/sync_schedule.py` 重新產生並部署之後。
 *
 *     npx tsx scripts/sync-schedule.ts            # 實際套用
 *     npx tsx scripts/sync-schedule.ts --dry-run  # 只看會改什麼，不寫入
 *
 * 只會動「官網說了算」的部分：週班表，以及本工具自己建立的日期例外
 * （createdBy = website-sync）。櫃檯在後台輸入的停診、代診、加開名額一律不動。
 */
import { PrismaClient } from "@prisma/client";
import { applySchedule, loadScheduleSource } from "../src/lib/schedule-source";
import { todayStr } from "../src/lib/tw-time";

const prisma = new PrismaClient();

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const source = loadScheduleSource();

  if (dryRun) {
    // 在交易內套用後回滾：拿到真實結果又不留下任何變更
    let preview: Awaited<ReturnType<typeof applySchedule>> | undefined;
    await prisma
      .$transaction(async (tx) => {
        preview = await applySchedule(tx as unknown as PrismaClient, source, todayStr());
        throw new Error("__ROLLBACK__");
      })
      .catch((e) => {
        if (!(e instanceof Error) || e.message !== "__ROLLBACK__") throw e;
      });
    report(preview!, true);
    return;
  }

  report(await applySchedule(prisma, source, todayStr()), false);
}

function report(r: Awaited<ReturnType<typeof applySchedule>>, dryRun: boolean) {
  const prefix = dryRun ? "（試算，未寫入）" : "";
  console.log(`${prefix}班表同步完成：`);
  console.log(`  週班表：新增 ${r.created}、更新 ${r.updated}、移除 ${r.removed}`);
  console.log(`  單日例外：套用 ${r.exceptionsApplied} 筆`);
  for (const w of r.warnings) console.log(`  ⚠️ ${w}`);
  if (!dryRun && (r.created || r.updated || r.removed)) {
    console.log("  ※ 班表變動可能影響既有預約，請到後台「排班管理」確認受影響名單。");
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
