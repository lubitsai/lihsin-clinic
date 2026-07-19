"use client";

/** 無 LINE 時的身分驗證：證件號＋生日＋手機 OTP（全部相符才可查詢） */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestQueryOtp, identityLogin } from "@/app/actions/portal";
import { Card, Alert } from "@/components/ui";
import { ID_TYPE_LABEL } from "@/lib/status-labels";

export function IdentityLoginForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    idType: "NATIONAL_ID" as "NATIONAL_ID" | "RESIDENT_CERT" | "PASSPORT",
    idNumber: "",
    birthDate: "",
    phone: "",
    otpCode: "",
  });
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const sendOtp = () => {
    if (!/^09\d{8}$/.test(form.phone)) return setError("手機號碼格式不正確");
    startTransition(async () => {
      const r = await requestQueryOtp(form.phone);
      if (!r.ok) return setError(r.message);
      setError("");
      setOtpSent(true);
      if (r.data?.devCode) setForm((f) => ({ ...f, otpCode: r.data!.devCode! }));
    });
  };

  const submit = () => {
    startTransition(async () => {
      const r = await identityLogin(form);
      if (!r.ok) return setError(r.message);
      router.refresh();
    });
  };

  return (
    <Card className="space-y-4">
      <h2 className="font-bold text-forest-700 text-lg">以證件號碼查詢</h2>
      {error && <Alert tone="error">{error}</Alert>}
      <label className="block">
        <span className="block text-sm font-medium text-stone-700 mb-1">證件類型</span>
        <div className="flex gap-2">
          {(Object.keys(ID_TYPE_LABEL) as (keyof typeof ID_TYPE_LABEL)[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setForm({ ...form, idType: t as typeof form.idType })}
              className={`rounded-xl border-2 px-3 py-2 ${
                form.idType === t
                  ? "border-forest-500 bg-forest-500/10 text-forest-700 font-bold"
                  : "border-cream-200 bg-white text-stone-600"
              }`}
            >
              {ID_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </label>
      <label className="block">
        <span className="block text-sm font-medium text-stone-700 mb-1">證件號碼</span>
        <input
          type="text"
          className="input"
          value={form.idNumber}
          onChange={(e) => setForm({ ...form, idNumber: e.target.value.toUpperCase().trim() })}
          autoComplete="off"
        />
      </label>
      <label className="block">
        <span className="block text-sm font-medium text-stone-700 mb-1">出生日期</span>
        <input
          type="date"
          className="input"
          value={form.birthDate}
          onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
        />
      </label>
      <label className="block">
        <span className="block text-sm font-medium text-stone-700 mb-1">預約時填寫的手機號碼</span>
        <input
          type="tel"
          inputMode="numeric"
          className="input"
          placeholder="09xxxxxxxx"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value.trim() })}
        />
      </label>
      <div className="flex gap-2">
        <button onClick={sendOtp} disabled={pending} className="btn-secondary shrink-0">
          {otpSent ? "重新傳送" : "傳送驗證碼"}
        </button>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          className="input"
          placeholder="6 位數驗證碼"
          value={form.otpCode}
          onChange={(e) => setForm({ ...form, otpCode: e.target.value.trim() })}
        />
      </div>
      <button onClick={submit} disabled={pending || !form.otpCode} className="btn-primary w-full">
        {pending ? "查詢中…" : "查詢我的預約"}
      </button>
    </Card>
  );
}
