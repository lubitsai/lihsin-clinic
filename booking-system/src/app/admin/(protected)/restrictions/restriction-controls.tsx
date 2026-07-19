"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminLiftRestriction, adminResetNoShow } from "@/app/actions/admin";

export function RestrictionListControls({
  restrictionId,
  patientId,
  noShowCount,
}: {
  restrictionId: string;
  patientId: string;
  noShowCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) return window.alert(r.message);
      router.refresh();
    });

  return (
    <span className="ml-auto flex gap-1.5">
      <button
        disabled={pending}
        onClick={() => {
          const reason = window.prompt("暫時解除原因：");
          if (!reason?.trim()) return;
          const until = window.prompt("暫時解除至哪一天？（YYYY-MM-DD）");
          if (!until || !/^\d{4}-\d{2}-\d{2}$/.test(until)) return window.alert("日期格式不正確");
          run(() => adminLiftRestriction(restrictionId, reason, until));
        }}
        className="qbtn bg-amber-500 text-white"
      >
        暫時解除
      </button>
      <button
        disabled={pending}
        onClick={() => {
          const reason = window.prompt("解除限制原因：");
          if (reason?.trim()) run(() => adminLiftRestriction(restrictionId, reason));
        }}
        className="qbtn bg-forest-600 text-white"
      >
        解除
      </button>
      {noShowCount > 0 && (
        <button
          disabled={pending}
          onClick={() => {
            const reason = window.prompt("重設未到次數原因：");
            if (reason?.trim()) run(() => adminResetNoShow(patientId, reason));
          }}
          className="qbtn bg-stone-500 text-white"
        >
          重設未到
        </button>
      )}
    </span>
  );
}
