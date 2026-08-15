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
  adminBindLineAccount,
  adminUnbindLineAccount,
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
      {saved && <span className="text-sage-600 text-sm ml-2">已儲存</span>}
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
                <span className="text-sm text-ink-500">{c.createdAt}</span>
                <button
                  onClick={() => save(name, c.value)}
                  disabled={pending}
                  className="qbtn bg-sage-600 text-white"
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
                  className="qbtn bg-white border border-sage-200 text-ink-900"
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
          <span className="text-sm text-ink-700">姓名</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm text-ink-700">手機</span>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value.trim())} />
        </label>
      </div>
      <button onClick={() => save()} disabled={pending} className="btn-secondary !py-2">
        儲存聯絡資料
      </button>
      {saved && <span className="text-sage-600 text-sm ml-2">已儲存</span>}
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
      className="ml-2 text-sm text-sage-600 underline underline-offset-2"
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
      <h2 className="font-bold text-sage-700">預約限制狀態</h2>
      {error && <Alert tone="error">{error}</Alert>}
      {restrictions.length === 0 && <p className="text-ink-500">無限制紀錄。</p>}
      <ul className="divide-y divide-sage-200 text-sm">
        {restrictions.map((r) => (
          <li key={r.id} className="py-2 flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 font-bold ${
              r.status === "ACTIVE" ? "bg-rose-200 text-rose-600" : r.status === "SUSPENDED" ? "bg-wood-200 text-wood-700" : "bg-sage-50 text-ink-500"
            }`}>
              {r.status === "ACTIVE" ? "生效中" : r.status === "SUSPENDED" ? `暫時解除至 ${r.suspendedUntil}` : "已解除"}
            </span>
            <span>{r.type === "AUTO_NO_SHOW" ? "未到累計自動" : "人工"}</span>
            <span className="text-ink-500">{r.createdAt}｜{r.reason}</span>
            {r.liftReason && <span className="text-sage-600">解除原因：{r.liftReason}</span>}
            {canManage && ["ACTIVE", "SUSPENDED"].includes(r.status) && (
              <span className="ml-auto flex gap-1.5">
                <button onClick={() => lift(r.id, true)} disabled={pending} className="qbtn bg-wood-600 text-white">
                  暫時解除
                </button>
                <button onClick={() => lift(r.id, false)} disabled={pending} className="qbtn bg-sage-600 text-white">
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


/**
 * LINE 綁定（櫃檯核對制）。
 *
 * 流程：家長在前台「查詢我的預約」按「取得櫃檯綁定代碼」→ 到櫃檯出示健保卡並告知代碼
 * → 櫃檯**當面核對是本人或其家長**後，在這裡輸入代碼。
 *
 * 系統只驗代碼有效，證明身分的是核對動作本身——所以務必先看健保卡再輸入。
 * 每次綁定與解除都會記進稽核（誰、什麼時候、綁了誰）。
 */
export function LineBindingControls({
  patientId,
  patientName,
  links,
}: {
  patientId: string;
  patientName: string;
  links: { lineAccountId: string; displayName: string | null; verifiedByStaff: boolean }[];
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [relation, setRelation] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const bind = () => {
    if (!window.confirm(`已當面核對 ${patientName} 的健保卡了嗎？確認後才建立綁定。`)) return;
    startTransition(async () => {
      const r = await adminBindLineAccount({ patientId, code, relation: relation || undefined });
      if (!r.ok) {
        setMessage("");
        return setError(r.message);
      }
      setError("");
      setMessage(`已綁定 LINE 帳號「${r.data?.displayName ?? "（未提供名稱）"}」。`);
      setCode("");
      setRelation("");
      router.refresh();
    });
  };

  const unbind = (lineAccountId: string, displayName: string | null) => {
    if (!window.confirm(`解除 ${patientName} 與「${displayName ?? "該 LINE 帳號"}」的綁定？解除後對方將收不到通知，也查不到這位病人的預約。`))
      return;
    startTransition(async () => {
      const r = await adminUnbindLineAccount(patientId, lineAccountId);
      if (!r.ok) return setError(r.message);
      setError("");
      setMessage("已解除綁定。");
      router.refresh();
    });
  };

  return (
    <Card className="space-y-3">
      <h2 className="font-bold text-sage-700">LINE 綁定</h2>
      {error && <Alert tone="error">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}

      {links.length === 0 ? (
        <p className="text-ink-500 text-sm">尚未綁定任何 LINE 帳號——這位病人收不到預約通知。</p>
      ) : (
        <ul className="divide-y divide-sage-200 text-sm">
          {links.map((l) => (
            <li key={l.lineAccountId} className="py-2 flex flex-wrap items-center gap-2">
              <span className="font-bold">{l.displayName ?? "（未提供名稱）"}</span>
              <span className="text-ink-500">
                {l.verifiedByStaff ? "櫃檯核對綁定" : "線上預約時自動綁定"}
              </span>
              <button
                onClick={() => unbind(l.lineAccountId, l.displayName)}
                disabled={pending}
                className="ml-auto text-ink-500 underline underline-offset-2"
              >
                解除綁定
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-sage-200 pt-3 space-y-2">
        <p className="text-sm text-ink-700">
          請家長在「查詢我的預約」頁按「取得櫃檯綁定代碼」，
          <strong>核對健保卡確認身分後</strong>再輸入下方代碼。
        </p>
        <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
          <input
            className="input font-mono tracking-widest"
            placeholder="綁定代碼"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={12}
            autoComplete="off"
          />
          <input
            className="input"
            placeholder="稱謂（選填，如：媽媽）"
            value={relation}
            onChange={(e) => setRelation(e.target.value)}
            maxLength={20}
          />
          <button onClick={bind} disabled={pending || code.trim().length < 4} className="btn-primary !py-2">
            {pending ? "綁定中…" : "確認綁定"}
          </button>
        </div>
      </div>
    </Card>
  );
}
