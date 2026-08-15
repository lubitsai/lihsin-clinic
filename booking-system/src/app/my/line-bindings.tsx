"use client";

/** LINE 帳號綁定管理：列出已綁定的家庭成員、新增綁定（證件＋生日＋手機三者相符）、解除 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bindFamilyMember, unbindFamilyMember, type LineBindingDto } from "@/app/actions/portal";
import { Card, Alert } from "@/components/ui";
import { ID_TYPE_LABEL } from "@/lib/status-labels";

export function LineBindings({ initial }: { initial: LineBindingDto[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    idType: "NATIONAL_ID" as "NATIONAL_ID" | "RESIDENT_CERT" | "PASSPORT",
    idNumber: "",
    birthDate: "",
    phone: "",
    relation: "",
  });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const bind = () => {
    if (!/^09\d{8}$/.test(form.phone)) return setError("手機號碼格式不正確");
    startTransition(async () => {
      const r = await bindFamilyMember({ ...form, relation: form.relation || undefined });
      if (!r.ok) return setError(r.message);
      setError("");
      setMessage(`已綁定 ${r.data?.name}，之後可直接以 LINE 管理其預約並接收通知。`);
      setAdding(false);
      setForm({ idType: "NATIONAL_ID", idNumber: "", birthDate: "", phone: "", relation: "" });
      router.refresh();
    });
  };

  const unbind = (b: LineBindingDto) => {
    if (!window.confirm(`解除與 ${b.name} 的綁定？解除後將收不到 ${b.name} 的預約通知。`)) return;
    startTransition(async () => {
      const r = await unbindFamilyMember(b.patientId);
      if (!r.ok) return setError(r.message);
      router.refresh();
    });
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-sage-700 text-lg">LINE 綁定的家庭成員</h2>
        {!adding && (
          <button onClick={() => setAdding(true)} className="btn-secondary !py-1.5 !px-3 text-sm">
            ＋ 新增成員
          </button>
        )}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}

      {initial.length === 0 && !adding && (
        <p className="text-ink-700 text-sm">
          尚未綁定任何看診成員。線上預約成立時會自動綁定該位病人；
          若要把先前（例如電話或現場掛號）建立的家人一併納入管理，可用下方「新增成員」。
          同一個 LINE 可綁定多位孩子或家人。
        </p>
      )}
      <ul className="divide-y divide-sage-200">
        {initial.map((b) => (
          <li key={b.patientId} className="py-2 flex items-center gap-3">
            <span className="font-bold">{b.name}</span>
            <span className="text-ink-500 text-sm">{b.idNumberMasked}</span>
            {b.relation && <span className="text-ink-500 text-sm">（{b.relation}）</span>}
            <button
              onClick={() => unbind(b)}
              disabled={pending}
              className="ml-auto text-sm text-ink-500 underline underline-offset-2"
            >
              解除綁定
            </button>
          </li>
        ))}
      </ul>

      {adding && (
        <div className="space-y-3 border-t border-sage-200 pt-3">
          <p className="text-sm text-ink-700">
            為保護個資，需輸入該成員的證件號碼、出生日期，以及本院病歷上登記的手機號碼，
            三項全部相符才能綁定。若手機已換號，請先致電診所更新病歷聯絡資料。
          </p>
          <div className="flex gap-2">
            {(Object.keys(ID_TYPE_LABEL) as (keyof typeof ID_TYPE_LABEL)[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setForm({ ...form, idType: t as typeof form.idType })}
                className={`rounded-xl border-2 px-3 py-2 ${
                  form.idType === t
                    ? "border-sage-500 bg-sage-500/10 text-sage-700 font-bold"
                    : "border-sage-200 bg-white text-ink-700"
                }`}
              >
                {ID_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <input
            className="input"
            placeholder="證件號碼"
            value={form.idNumber}
            onChange={(e) => setForm({ ...form, idNumber: e.target.value.toUpperCase().trim() })}
            autoComplete="off"
          />
          <div className="grid grid-cols-2 gap-2">
            <input type="date" className="input" value={form.birthDate}
              onChange={(e) => setForm({ ...form, birthDate: e.target.value })} />
            <input className="input" placeholder="稱謂（選填，如：大寶）" value={form.relation}
              onChange={(e) => setForm({ ...form, relation: e.target.value })} maxLength={20} />
          </div>
          <input
            type="tel"
            inputMode="numeric"
            className="input"
            placeholder="病歷上的手機 09xxxxxxxx"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value.trim() })}
          />
          <div className="flex gap-2">
            <button
              onClick={bind}
              disabled={pending || !form.idNumber || !form.birthDate || !form.phone}
              className="btn-primary flex-1"
            >
              {pending ? "綁定中…" : "確認綁定"}
            </button>
            <button onClick={() => { setAdding(false); setError(""); }} className="btn-secondary">
              取消
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
