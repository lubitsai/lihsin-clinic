"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminMergePatients } from "@/app/actions/admin";

/** 合併病歷：二次確認（輸入「合併」），保留原始資料 */
export function MergeButton({ keepId, mergeId }: { keepId: string; mergeId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const merge = () => {
    const confirm = window.prompt(
      "合併後，右側病歷的預約與未到紀錄將併入左側病歷（原始資料保留、不可復原操作）。\n請輸入「合併」二字確認：",
    );
    if (confirm === null) return;
    startTransition(async () => {
      const r = await adminMergePatients(keepId, mergeId, confirm);
      if (!r.ok) return window.alert(r.message);
      router.refresh();
    });
  };
  return (
    <button onClick={merge} disabled={pending} className="ml-auto qbtn bg-persimmon-500 text-white">
      合併 →
    </button>
  );
}
