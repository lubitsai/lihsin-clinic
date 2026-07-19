"use client";

/** 前台七步驟預約精靈：可返回上一步；requestId 防重複送出；規則以後端為準 */
import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  fetchOpenDates,
  fetchDaySlots,
  requestBookingOtp,
  submitBooking,
} from "@/app/actions/portal";
import { Card, StepProgress, Alert } from "@/components/ui";
import { formatDateTw } from "@/lib/tw-time";
import { SESSION_META, ID_TYPE_LABEL } from "@/lib/status-labels";

interface ClinicTypeDto {
  id: string;
  name: string;
  description: string | null;
  notice: string | null;
  color: string;
  icon: string;
  requiresReview: boolean;
  doctors: { id: string; name: string; title: string | null }[];
}

type OpenDate = { date: string; open: boolean; hasFreeSlot: boolean };
type Slot = {
  startTime: string;
  session: "MORNING" | "AFTERNOON" | "EVENING";
  doctors: { doctorId: string; doctorName: string; remaining: number }[];
};

const STEP_LABELS = ["選擇門診", "選擇醫師", "選擇日期", "選擇時段", "填寫資料", "確認送出", "完成"];

const CLINIC_ICONS: Record<string, string> = {
  stethoscope: "🩺",
  growth: "📏",
  scale: "⚖️",
  allergy: "🌼",
};

export function BookingWizard({
  clinicTypes,
  lineConfigured,
  viaLine,
}: {
  clinicTypes: ClinicTypeDto[];
  lineConfigured: boolean;
  viaLine: boolean;
}) {
  const [step, setStep] = useState(1);
  const [clinicType, setClinicType] = useState<ClinicTypeDto | null>(null);
  const [doctorId, setDoctorId] = useState<string>("any");
  const [openDates, setOpenDates] = useState<OpenDate[]>([]);
  const [date, setDate] = useState<string>("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [startTime, setStartTime] = useState<string>("");
  const [patient, setPatient] = useState({
    name: "",
    phone: "",
    birthDate: "",
    idType: "NATIONAL_ID" as "NATIONAL_ID" | "RESIDENT_CERT" | "PASSPORT",
    idNumber: "",
    visitType: "" as "" | "FIRST_VISIT" | "RETURN_VISIT",
    note: "",
  });
  const [agree, setAgree] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [needOtp, setNeedOtp] = useState(!viaLine);
  const [requestId, setRequestId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<{ bookingNumber: string; status: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const doctorName = useMemo(() => {
    if (doctorId === "any") return "不限醫師（系統安排）";
    return clinicType?.doctors.find((d) => d.id === doctorId)?.name ?? "";
  }, [doctorId, clinicType]);

  const goto = useCallback((s: number) => {
    setError("");
    setStep(s);
  }, []);

  // 步驟 1 → 2
  const pickClinicType = (t: ClinicTypeDto) => {
    setClinicType(t);
    setDoctorId("any");
    goto(2);
  };

  // 步驟 2 → 3：載入開放日期
  const pickDoctor = (id: string) => {
    if (!clinicType) return;
    setDoctorId(id);
    startTransition(async () => {
      const r = await fetchOpenDates(clinicType.id, id);
      if (!r.ok) return setError(r.message);
      setOpenDates(r.data ?? []);
      goto(3);
    });
  };

  // 步驟 3 → 4：載入時段
  const pickDate = (d: string) => {
    if (!clinicType) return;
    setDate(d);
    startTransition(async () => {
      const r = await fetchDaySlots(clinicType.id, d, doctorId);
      if (!r.ok) return setError(r.message);
      setSlots(r.data ?? []);
      goto(4);
    });
  };

  const pickSlot = (t: string) => {
    setStartTime(t);
    goto(5);
  };

  const toConfirm = () => {
    if (!patient.name.trim()) return setError("請輸入病人姓名");
    if (!/^09\d{8}$/.test(patient.phone)) return setError("手機號碼格式不正確（09 開頭共 10 碼）");
    if (!patient.birthDate) return setError("請選擇出生日期");
    if (!patient.idNumber.trim()) return setError("請輸入證件號碼");
    if (!agree) return setError("請先閱讀並勾選同意個資告知事項");
    setRequestId(crypto.randomUUID()); // 進入確認頁時產生一次性編號，防重複送出
    goto(6);
  };

  const sendOtp = () => {
    startTransition(async () => {
      const r = await requestBookingOtp(patient.phone);
      if (!r.ok) return setError(r.message);
      setOtpSent(true);
      setError("");
      if (r.data?.devCode) setOtpCode(r.data.devCode); // 測試環境自動帶入
    });
  };

  const submit = () => {
    if (!clinicType || pending) return;
    startTransition(async () => {
      const r = await submitBooking({
        clinicTypeId: clinicType.id,
        doctorId,
        date,
        startTime,
        requestId,
        otpCode: otpCode || undefined,
        patient: {
          name: patient.name.trim(),
          phone: patient.phone,
          birthDate: patient.birthDate,
          idType: patient.idType,
          idNumber: patient.idNumber.trim(),
          visitType: patient.visitType || undefined,
          note: patient.note.trim() || undefined,
        },
      });
      if (!r.ok) {
        if (viaLine && !needOtp && r.message.includes("驗證碼")) setNeedOtp(true);
        setError(r.message);
        return;
      }
      setResult(r.data!);
      goto(7);
    });
  };

  return (
    <div>
      <StepProgress current={step} total={7} labels={STEP_LABELS} />
      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <h1 className="text-xl font-bold text-forest-700">請選擇門診類型</h1>
          {clinicTypes.map((t) => (
            <button
              key={t.id}
              onClick={() => pickClinicType(t)}
              className="w-full text-left rounded-card bg-white border-2 border-cream-200 hover:border-forest-500 p-4 transition flex items-start gap-3"
            >
              <span className="text-3xl" aria-hidden>
                {CLINIC_ICONS[t.icon] ?? "🩺"}
              </span>
              <span>
                <span className="block text-lg font-bold" style={{ color: t.color }}>
                  {t.name}
                </span>
                {t.description && <span className="block text-stone-600 text-sm mt-0.5">{t.description}</span>}
                {t.requiresReview && (
                  <span className="block text-amber-700 text-sm mt-0.5">此門診送出後需櫃檯確認</span>
                )}
              </span>
            </button>
          ))}
          {!viaLine && lineConfigured && (
            <p className="text-sm text-stone-600 text-center pt-2">
              已加入 LINE？
              <a href="/api/line/login?next=/book" className="text-forest-600 underline underline-offset-2">
                以 LINE 登入
              </a>
              可加快填寫並接收通知
            </p>
          )}
        </div>
      )}

      {step === 2 && clinicType && (
        <div className="space-y-3">
          <h1 className="text-xl font-bold text-forest-700">請選擇醫師</h1>
          {clinicType.notice && <Alert tone="info">{clinicType.notice}</Alert>}
          <button
            onClick={() => pickDoctor("any")}
            disabled={pending}
            className="w-full rounded-card bg-white border-2 border-cream-200 hover:border-forest-500 p-4 text-left transition"
          >
            <span className="text-lg font-bold text-forest-700">不限醫師</span>
            <span className="block text-sm text-stone-600">由系統安排當時段仍有名額的醫師</span>
          </button>
          {clinicType.doctors.map((d) => (
            <button
              key={d.id}
              onClick={() => pickDoctor(d.id)}
              disabled={pending}
              className="w-full rounded-card bg-white border-2 border-cream-200 hover:border-forest-500 p-4 text-left transition"
            >
              <span className="text-lg font-bold text-forest-700">{d.name}醫師</span>
              {d.title && <span className="block text-sm text-stone-600">{d.title}</span>}
            </button>
          ))}
          <BackButton onClick={() => goto(1)} />
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <h1 className="text-xl font-bold text-forest-700">請選擇日期</h1>
          <p className="text-sm text-stone-600">開放今日起 {openDates.length} 天內預約；灰色表示休診或額滿。</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {openDates.map((d) => {
              const disabled = !d.open || !d.hasFreeSlot;
              return (
                <button
                  key={d.date}
                  onClick={() => !disabled && pickDate(d.date)}
                  disabled={disabled || pending}
                  className={`rounded-xl border-2 px-3 py-3 text-center transition ${
                    disabled
                      ? "bg-cream-100 border-cream-200 text-stone-400"
                      : "bg-white border-cream-200 hover:border-forest-500 text-stone-800"
                  }`}
                >
                  <span className="block font-bold">{formatDateTw(d.date)}</span>
                  <span className="block text-xs mt-0.5">
                    {!d.open ? "休診" : d.hasFreeSlot ? "可預約" : "已額滿"}
                  </span>
                </button>
              );
            })}
          </div>
          <BackButton onClick={() => goto(2)} />
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <h1 className="text-xl font-bold text-forest-700">
            {formatDateTw(date)}｜請選擇時段
          </h1>
          {(["MORNING", "AFTERNOON", "EVENING"] as const).map((session) => {
            const list = slots.filter((s) => s.session === session);
            if (list.length === 0) return null;
            return (
              <div key={session}>
                <h2 className="font-bold text-bark-600 mb-2">{SESSION_META[session].label}</h2>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {list.map((s) => {
                    const remaining = s.doctors.reduce((acc, d) => acc + d.remaining, 0);
                    const full = remaining <= 0;
                    return (
                      <button
                        key={s.startTime}
                        onClick={() => !full && pickSlot(s.startTime)}
                        disabled={full}
                        className={`rounded-xl border-2 py-2.5 font-bold transition ${
                          full
                            ? "bg-cream-100 border-cream-200 text-stone-400 line-through"
                            : "bg-white border-cream-200 hover:border-forest-500 text-forest-700"
                        }`}
                      >
                        {s.startTime}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {slots.length === 0 && <Alert tone="warn">此日期目前沒有可預約時段，請返回選擇其他日期。</Alert>}
          <BackButton onClick={() => goto(3)} />
        </div>
      )}

      {step === 5 && (
        <div className="space-y-4">
          <h1 className="text-xl font-bold text-forest-700">請填寫看診病人資料</h1>
          <Card className="space-y-4">
            <Field label="病人姓名（必填）">
              <input
                type="text"
                value={patient.name}
                onChange={(e) => setPatient({ ...patient, name: e.target.value })}
                className="input"
                autoComplete="name"
              />
            </Field>
            <Field label="手機號碼（必填，接收通知與驗證碼）">
              <input
                type="tel"
                inputMode="numeric"
                placeholder="09xxxxxxxx"
                value={patient.phone}
                onChange={(e) => setPatient({ ...patient, phone: e.target.value.trim() })}
                className="input"
                autoComplete="tel"
              />
            </Field>
            <Field label="出生日期（必填）">
              <input
                type="date"
                value={patient.birthDate}
                onChange={(e) => setPatient({ ...patient, birthDate: e.target.value })}
                className="input"
                max={new Date().toISOString().slice(0, 10)}
              />
            </Field>
            <Field label="證件類型">
              <div className="flex gap-2">
                {(Object.keys(ID_TYPE_LABEL) as (keyof typeof ID_TYPE_LABEL)[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setPatient({ ...patient, idType: t as typeof patient.idType })}
                    className={`rounded-xl border-2 px-3 py-2 ${
                      patient.idType === t
                        ? "border-forest-500 bg-forest-500/10 text-forest-700 font-bold"
                        : "border-cream-200 bg-white text-stone-600"
                    }`}
                  >
                    {ID_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </Field>
            <Field
              label={`${ID_TYPE_LABEL[patient.idType]}號碼（必填，用於識別病人，系統加密保存）`}
            >
              <input
                type="text"
                value={patient.idNumber}
                onChange={(e) => setPatient({ ...patient, idNumber: e.target.value.toUpperCase().trim() })}
                className="input"
                autoComplete="off"
              />
            </Field>
            <Field label="初診／複診（選填）">
              <div className="flex gap-2">
                {([
                  ["", "不確定"],
                  ["FIRST_VISIT", "初診"],
                  ["RETURN_VISIT", "複診"],
                ] as const).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setPatient({ ...patient, visitType: v })}
                    className={`rounded-xl border-2 px-3 py-2 ${
                      patient.visitType === v
                        ? "border-forest-500 bg-forest-500/10 text-forest-700 font-bold"
                        : "border-cream-200 bg-white text-stone-600"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="備註（選填，如症狀簡述）">
              <textarea
                value={patient.note}
                onChange={(e) => setPatient({ ...patient, note: e.target.value })}
                className="input min-h-20"
                maxLength={200}
              />
            </Field>
            <label className="flex items-start gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                className="mt-1 size-4 accent-forest-600"
              />
              <span>
                我已閱讀並同意
                <Link href="/rules" target="_blank" className="text-forest-600 underline underline-offset-2 mx-1">
                  預約規則與個人資料告知事項
                </Link>
              </span>
            </label>
          </Card>
          <div className="flex gap-3">
            <BackButton onClick={() => goto(4)} />
            <button onClick={toConfirm} className="btn-primary flex-1">
              下一步：確認預約內容
            </button>
          </div>
        </div>
      )}

      {step === 6 && clinicType && (
        <div className="space-y-4">
          <h1 className="text-xl font-bold text-forest-700">請確認預約內容</h1>
          <Card>
            <dl className="space-y-2 text-lg">
              <Row label="門診">{clinicType.name}</Row>
              <Row label="醫師">{doctorName}</Row>
              <Row label="日期">{formatDateTw(date)}</Row>
              <Row label="時段">{startTime}</Row>
              <Row label="病人">{patient.name}</Row>
              <Row label="手機">{patient.phone}</Row>
            </dl>
          </Card>
          {clinicType.requiresReview && (
            <Alert tone="warn">此門診預約送出後為「待確認」，櫃檯確認後會再通知您。</Alert>
          )}
          {needOtp && (
            <Card className="space-y-3">
              <p className="font-bold text-forest-700">手機驗證</p>
              <p className="text-sm text-stone-600">
                為確認是本人預約，請點選「傳送驗證碼」，輸入 {patient.phone} 收到的 6 位數字。
              </p>
              <div className="flex gap-2">
                <button onClick={sendOtp} disabled={pending} className="btn-secondary shrink-0">
                  {otpSent ? "重新傳送" : "傳送驗證碼"}
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 位數驗證碼"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.trim())}
                  className="input"
                />
              </div>
            </Card>
          )}
          <div className="flex gap-3">
            <BackButton onClick={() => goto(5)} />
            <button
              onClick={submit}
              disabled={pending || (needOtp && !otpCode)}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {pending ? "送出中…" : "確認送出預約"}
            </button>
          </div>
        </div>
      )}

      {step === 7 && result && (
        <div className="space-y-4 text-center py-6">
          <div className="text-6xl" aria-hidden>
            🦌🎉
          </div>
          <h1 className="text-2xl font-bold text-forest-700">
            {result.status === "PENDING" ? "預約已送出，待櫃檯確認" : "預約成功！"}
          </h1>
          <Card className="inline-block text-left">
            <p className="text-stone-600 text-sm">您的預約編號</p>
            <p className="text-3xl font-mono font-bold text-persimmon-500 tracking-wider">
              {result.bookingNumber}
            </p>
            <p className="mt-3 text-stone-700">
              {formatDateTw(date)} {startTime}｜{doctorName}｜{clinicType?.name}
            </p>
          </Card>
          <p className="text-stone-600 text-sm px-4">
            已透過 LINE 或簡訊發送預約通知。線上預約不等於實際看診號碼，請依現場狀況候診。
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/my" className="btn-secondary">
              查詢我的預約
            </Link>
            <Link href="/" className="btn-primary">
              回首頁
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="btn-secondary">
      ← 上一步
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-stone-700 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-16 text-stone-500 shrink-0">{label}</dt>
      <dd className="font-bold text-stone-800">{children}</dd>
    </div>
  );
}
