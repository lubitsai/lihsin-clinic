"use client";

/**
 * 櫃檯代約／改期表單：
 * - 病人可搜尋既有病歷或新建資料
 * - 時段以櫃檯視角顯示（含不開放線上者）
 * - 撞到同日/7天/受限限制時，跳出理由欄位覆寫（留稽核）
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adminSearchPatients,
  adminFetchDaySlots,
  adminCreateBooking,
  adminReschedule,
} from "@/app/actions/admin";
import { Card, Alert } from "@/components/ui";
import { formatDateTw, todayStr, addDays } from "@/lib/tw-time";
import { ID_TYPE_LABEL } from "@/lib/status-labels";

interface ClinicTypeOpt {
  id: string;
  name: string;
  doctors: { id: string; name: string }[];
}

interface RescheduleInfo {
  id: string;
  bookingNumber: string;
  date: string;
  startTime: string;
  doctorName: string;
  clinicTypeId: string;
  clinicTypeName: string;
  patientName: string;
  status: string;
}

interface PresetPatient {
  id: string;
  name: string;
  phone: string;
  idNumberMasked: string;
  birthDate: string;
  noShowCount: number;
}

type SlotDto = { doctorId: string; doctorName: string; startTime: string; remaining: number; capacity: number };

export function StaffBookingForm({
  clinicTypes,
  reschedule,
  presetPatient,
}: {
  clinicTypes: ClinicTypeOpt[];
  reschedule: RescheduleInfo | null;
  presetPatient: PresetPatient | null;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pending, startTransition] = useTransition();

  // 病人選擇（改期模式不需要）
  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<PresetPatient[] | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<PresetPatient | null>(presetPatient);
  const [newPatient, setNewPatient] = useState({
    name: "",
    phone: "",
    birthDate: "",
    idType: "NATIONAL_ID" as "NATIONAL_ID" | "RESIDENT_CERT" | "PASSPORT",
    idNumber: "",
  });
  const [useNewPatient, setUseNewPatient] = useState(false);

  // 時段選擇
  const [clinicTypeId, setClinicTypeId] = useState(reschedule?.clinicTypeId ?? clinicTypes[0]?.id ?? "");
  const [date, setDate] = useState(todayStr());
  const [slots, setSlots] = useState<SlotDto[] | null>(null);
  const [selected, setSelected] = useState<{ doctorId: string; startTime: string } | null>(null);
  const [staffNote, setStaffNote] = useState("");

  // 覆寫
  const [needOverride, setNeedOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const searchPatient = () => {
    startTransition(async () => {
      const r = await adminSearchPatients(patientQuery);
      if (!r.ok) return setError(r.message);
      setPatientResults((r.data ?? []).map((p) => ({ ...p })));
      setError("");
    });
  };

  const loadSlots = (d: string) => {
    setDate(d);
    setSelected(null);
    startTransition(async () => {
      const r = await adminFetchDaySlots(d);
      if (!r.ok) return setError(r.message);
      setSlots(r.data ?? []);
      setError("");
    });
  };

  const submit = () => {
    if (!selected) return setError("請選擇時段");
    startTransition(async () => {
      if (reschedule) {
        const r = await adminReschedule({
          appointmentId: reschedule.id,
          newDoctorId: selected.doctorId,
          newDate: date,
          newStartTime: selected.startTime,
          overrideReason: needOverride ? overrideReason : undefined,
        });
        if (!r.ok) {
          if (!needOverride && /當天已有預約|7 天內|無法使用線上預約/.test(r.message)) {
            setNeedOverride(true);
            setError(`${r.message}（如需強制改期，請輸入覆寫理由後再送出）`);
            return;
          }
          return setError(r.message);
        }
        setSuccess(`改期完成，新預約編號 ${r.data?.bookingNumber}`);
        setTimeout(() => router.push("/admin"), 1200);
        return;
      }

      const base = {
        clinicTypeId,
        doctorId: selected.doctorId,
        date,
        startTime: selected.startTime,
        staffNote: staffNote || undefined,
        overrideReason: needOverride ? overrideReason : undefined,
      };
      const payload = useNewPatient
        ? { ...base, patient: { ...newPatient, idNumber: newPatient.idNumber.trim() } }
        : { ...base, patientId: selectedPatient?.id };
      if (!useNewPatient && !selectedPatient) return setError("請先搜尋並選擇病人，或改用新病人");

      const r = await adminCreateBooking(payload);
      if (!r.ok) {
        if (!needOverride && /當天已有預約|7 天內|無法使用線上預約/.test(r.message)) {
          setNeedOverride(true);
          setError(`${r.message}（如需代約，請輸入覆寫理由後再送出）`);
          return;
        }
        return setError(r.message);
      }
      setSuccess(
        `預約成立，編號 ${r.data?.bookingNumber}${r.data?.usedOverride ? "（已使用限制覆寫，稽核已記錄）" : ""}`,
      );
      setTimeout(() => router.push("/admin"), 1200);
    });
  };

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      {reschedule ? (
        <Card>
          <p className="font-bold text-stone-800">
            原預約：{reschedule.bookingNumber}｜{reschedule.patientName}
          </p>
          <p className="text-stone-600">
            {formatDateTw(reschedule.date)} {reschedule.startTime}｜{reschedule.doctorName}醫師｜
            {reschedule.clinicTypeName}
          </p>
        </Card>
      ) : (
        <Card className="space-y-3">
          <h2 className="font-bold text-forest-700">1. 病人</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setUseNewPatient(false)}
              className={`rounded-xl border-2 px-3 py-2 ${!useNewPatient ? "border-forest-500 bg-forest-500/10 font-bold text-forest-700" : "border-cream-200"}`}
            >
              既有病人
            </button>
            <button
              onClick={() => setUseNewPatient(true)}
              className={`rounded-xl border-2 px-3 py-2 ${useNewPatient ? "border-forest-500 bg-forest-500/10 font-bold text-forest-700" : "border-cream-200"}`}
            >
              新病人
            </button>
          </div>

          {!useNewPatient ? (
            <>
              <div className="flex gap-2">
                <input
                  className="input"
                  placeholder="姓名／電話／證件末碼"
                  value={patientQuery}
                  onChange={(e) => setPatientQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchPatient()}
                />
                <button onClick={searchPatient} disabled={pending} className="btn-secondary shrink-0">
                  搜尋
                </button>
              </div>
              {selectedPatient && (
                <Alert tone="success">
                  已選擇：{selectedPatient.name}（{selectedPatient.idNumberMasked}）｜{selectedPatient.phone}
                  {selectedPatient.noShowCount > 0 && `｜⚠️ 未到 ${selectedPatient.noShowCount} 次`}
                </Alert>
              )}
              {patientResults && (
                <ul className="divide-y divide-cream-200 border border-cream-200 rounded-xl overflow-hidden">
                  {patientResults.length === 0 && (
                    <li className="px-3 py-2 text-stone-500">查無病人，可改用「新病人」建立</li>
                  )}
                  {patientResults.map((p) => (
                    <li key={p.id}>
                      <button
                        onClick={() => setSelectedPatient(p)}
                        className="w-full text-left px-3 py-2 hover:bg-cream-100"
                      >
                        {p.name}｜{p.idNumberMasked}｜{p.phone}｜{p.birthDate}
                        {p.noShowCount > 0 && (
                          <span className="text-persimmon-600 ml-1">未到{p.noShowCount}次</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              <input className="input" placeholder="姓名" value={newPatient.name}
                onChange={(e) => setNewPatient({ ...newPatient, name: e.target.value })} />
              <input className="input" placeholder="手機 09xxxxxxxx" value={newPatient.phone}
                onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value.trim() })} />
              <input type="date" className="input" value={newPatient.birthDate}
                onChange={(e) => setNewPatient({ ...newPatient, birthDate: e.target.value })} />
              <div className="flex gap-2">
                <select
                  className="input !w-auto"
                  value={newPatient.idType}
                  onChange={(e) => setNewPatient({ ...newPatient, idType: e.target.value as typeof newPatient.idType })}
                >
                  {Object.entries(ID_TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <input className="input" placeholder="證件號碼" value={newPatient.idNumber}
                  onChange={(e) => setNewPatient({ ...newPatient, idNumber: e.target.value.toUpperCase() })} />
              </div>
            </div>
          )}
        </Card>
      )}

      <Card className="space-y-3">
        <h2 className="font-bold text-forest-700">{reschedule ? "選擇新時段" : "2. 門診與時段"}</h2>
        {!reschedule && (
          <select className="input !w-auto" value={clinicTypeId} onChange={(e) => setClinicTypeId(e.target.value)}>
            {clinicTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="date"
            className="input !w-auto"
            value={date}
            min={addDays(todayStr(), -30)}
            onChange={(e) => loadSlots(e.target.value)}
          />
          <button onClick={() => loadSlots(date)} disabled={pending} className="btn-secondary !py-2">
            載入時段
          </button>
          <span className="text-sm text-stone-500">{formatDateTw(date)}（櫃檯可見全部時段，含未開放線上者）</span>
        </div>
        {slots && slots.length === 0 && <Alert tone="warn">此日期無排班時段。</Alert>}
        {slots && slots.length > 0 && (
          <div className="space-y-2">
            {[...new Set(slots.map((s) => s.doctorId))].map((docId) => {
              const docSlots = slots.filter((s) => s.doctorId === docId);
              return (
                <div key={docId}>
                  <p className="font-medium text-bark-600 mb-1">{docSlots[0].doctorName}醫師</p>
                  <div className="flex flex-wrap gap-1.5">
                    {docSlots.map((s) => {
                      const isSel = selected?.doctorId === docId && selected?.startTime === s.startTime;
                      const full = s.remaining <= 0;
                      return (
                        <button
                          key={s.startTime}
                          onClick={() => !full && setSelected({ doctorId: docId, startTime: s.startTime })}
                          disabled={full}
                          className={`rounded-lg border-2 px-2.5 py-1.5 text-sm font-bold ${
                            isSel
                              ? "border-forest-600 bg-forest-600 text-white"
                              : full
                                ? "border-cream-200 bg-cream-100 text-stone-400 line-through"
                                : "border-cream-200 bg-white text-forest-700 hover:border-forest-500"
                          }`}
                          title={`剩餘 ${s.remaining}/${s.capacity}`}
                        >
                          {s.startTime}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!reschedule && (
          <input
            className="input"
            placeholder="櫃檯備註（選填）"
            value={staffNote}
            onChange={(e) => setStaffNote(e.target.value)}
            maxLength={300}
          />
        )}
      </Card>

      {needOverride && (
        <Card className="space-y-2 border-persimmon-500/50">
          <p className="font-bold text-persimmon-600">限制覆寫理由（必填，將寫入稽核紀錄）</p>
          <input
            className="input"
            placeholder="例如：家長來電說明特殊狀況，主管同意"
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
          />
        </Card>
      )}

      <button
        onClick={submit}
        disabled={pending || !selected || (needOverride && !overrideReason.trim())}
        className="btn-primary w-full"
      >
        {pending ? "處理中…" : reschedule ? "確認改期" : "建立預約"}
      </button>
    </div>
  );
}
