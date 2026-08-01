"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adminUpdatePatientNote,
  adminUpdatePatientContact,
  adminDismissPendingContact,
  adminRevealIdNumber,
  adminLiftRestriction,
  adminResetNoShow,
  adminCreateRestriction,
} from "@/app/actions/admin";
import { Card, Alert } from "@/components/ui";

export function PatientNoteForm({ patientId, initialNote }: { patientId: string; initialNote: string }) {
  const [note, setNote] = useState(initialNote);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-2">
      <textarea className="input min-h-20" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      <button
        onClick={() =>
          startTransition(async () => {
            const r = await adminUpdatePatientNote(patientId, note);
            setSaved(r.ok);
          })
        }
        disabled={pending}
        className="btn-secondary !py-2"
      >
        儲存備註
      </button>
      {saved && <span className="text-forest-600 text-sm ml-2">已儲存</span>}
    </div>
  );
}

/**
 * 姓名／手機編輯（前台預約不會自動覆寫既有病歷，改由櫃檯核對身分後在此更新）。
 * pendingContacts＝民眾線上預約時填寫、與病歷不符的電話，供一鍵採用或忽略。
 */
export function PatientContactForm({
  patientId,
  initialName,
  initialPhone,
  pendingContacts,
}: {
  patientId: string;
  initialName: string;
  initialPhone: string;
  pendingContacts: { id: string; value: string; createdAt: string }[];
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = (nextName = name, nextPhone = phone) =>
    startTransition(async () => {
      const r = await adminUpdatePatientContact({ patientId, name: nextName, phone: nextPhone });
      if (!r.ok) return setError(r.message);
      setError("");
      setSaved(true);
      setName(nextName);
      setPhone(nextPhone);
      router.refresh();
    });

  return (
    <div className="space-y-2">
      {error && <Alert tone="error">{error}</Alert>}
      {pendingContacts.length > 0 && (
        <Alert tone="warn">
          <p className="font-bold mb-1">民眾線上預約時填寫了不同的電話</p>
          <ul className="space-y-1">
            {pendingContacts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{c.value}</span>
                <span className="text-sm text-stone-500">{c.createdAt}</span>
                <button
                  onClick={() => save(name, c.value)}
                  disabled={pending}
                  className="qbtn bg-forest-600 text-white"
                >
                  確認後更新為此號碼
                </button>
                <button
                  onClick={() =>
                    startTransition(async () => {
                      await adminDismissPendingContact(c.id);
                      router.refresh();
                    })
                  }
                  disabled={pending}
                  className="qbtn bg-white border border-cream-200 text-stone-700"
                >
                  忽略
                </button>
              </li>
            ))}
          </ul>
          <p className="text-sm mt-1">請先與家長確認身分再更新，避免他人冒用。</p>
        </Alert>
      )}
      <div className="grid sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="text-sm text-stone-600">姓名</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm text-stone-600">手機</span>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value.trim())} />
        </label>
      </div>
      <button onClick={() => save()} disabled={pending} className="btn-secondary !py-2">
        儲存聯絡資料
      </button>
      {saved && <span className="text-forest-600 text-sm ml-2">已儲存</span>}
    </div>
  );
}

/** 查看完整證件號（需 pii:full；每次查看留稽核） */
export function RevealIdButton({ patientId }: { patientId: string }) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (revealed) return <span className="ml-2 font-mono">{revealed}</span>;
  return (
    <button
      onClick={() =>
        startTransition(async () => {
          const r = await adminRevealIdNumber(patientId);
          if (r.ok) setRevealed(r.data!.idNumber);
          else window.alert(r.message);
        })
      }
      disabled={pending}
      className="ml-2 text-sm text-forest-600 underline underline-offset-2"
      title="查看行為將寫入稽核紀錄"
    >
      顯示完整號碼
    </button>
  );
}

interface RestrictionDto {
  id: string;
  type: string;
  status: string;
  reason: string;
  createdAt: string;
  suspendedUntil: string | null;
  liftReason: string | null;
}

export function RestrictionControls({
  patientId,
  restrictions,
  noShowCount,
  canManage,
}: {
  patientId: string;
  restrictions: RestrictionDto[];
  noShowCount: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const act = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.message ?? "操作失敗");
      setError("");
      router.refresh();
    });

  const lift = (id: string, suspend: boolean) => {
    const reason = window.prompt(suspend ? "暫時解除原因：" : "解除限制原因：");
    if (!reason?.trim()) return;
    let until: string | undefined;
    if (suspend) {
      until = window.prompt("暫時解除至哪一天？（YYYY-MM-DD）") ?? undefined;
      if (!until || !/^\d{4}-\d{2}-\d{2}$/.test(until)) return window.alert("日期格式不正確");
    }
    act(() => adminLiftRestriction(id, reason, until));
  };

  const active = restrictions.filter((r) => ["ACTIVE", "SUSPENDED"].includes(r.status));

  return (
    <Card className="space-y-3">
      <h2 className="font-bold text-forest-700">預約限制狀態</h2>
      {error && <Alert tone="error">{error}</Alert>}
      {restrictions.length === 0 && <p className="text-stone-500">無限制紀錄。</p>}
      <ul className="divide-y divide-cream-200 text-sm">
        {restrictions.map((r) => (
          <li key={r.id} className="py-2 flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 font-bold ${
              r.status === "ACTIVE" ? "bg-red-100 text-red-800" : r.status === "SUSPENDED" ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-500"
            }`}>
              {r.status === "ACTIVE" ? "生效中" : r.status === "SUSPENDED" ? `暫時解除至 ${r.suspendedUntil}` : "已解除"}
            </span>
            <span>{r.type === "AUTO_NO_SHOW" ? "未到累計自動" : "人工"}</span>
            <span className="text-stone-500">{r.createdAt}｜{r.reason}</span>
            {r.liftReason && <span className="text-forest-600">解除原因：{r.liftReason}</span>}
            {canManage && ["ACTIVE", "SUSPENDED"].includes(r.status) && (
              <span className="ml-auto flex gap-1.5">
                <button onClick={() => lift(r.id, true)} disabled={pending} className="qbtn bg-amber-500 text-white">
                  暫時解除
                </button>
                <button onClick={() => lift(r.id, false)} disabled={pending} className="qbtn bg-forest-600 text-white">
                  解除
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="flex flex-wrap gap-2 pt-1">
          {noShowCount > 0 && (
            <button
              onClick={() => {
                const reason = window.prompt("重設未到次數為 0 的原因：");
                if (reason?.trim()) act(() => adminResetNoShow(patientId, reason));
              }}
              disabled={pending}
              className="btn-secondary !py-2"
            >
              重設未到次數（目前 {noShowCount}）
            </button>
          )}
          {active.length === 0 && (
            <button
              onClick={() => {
                const reason = window.prompt("人工加入預約限制的原因：");
                if (reason?.trim()) act(() => adminCreateRestriction(patientId, reason));
              }}
              disabled={pending}
              className="btn-danger !py-2"
            >
              人工加入限制
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
