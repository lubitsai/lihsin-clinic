"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminUpdateSettings, adminUpdateClinicType, adminUpsertDoctor } from "@/app/actions/admin";
import { Card, Alert } from "@/components/ui";
import { SESSION_META } from "@/lib/status-labels";
import { WEEKDAY_ZH as WEEKDAYS } from "@/lib/tw-time";
import type { SessionPeriod } from "@prisma/client";


interface ClinicTypeDto {
  id: string;
  code: string;
  name: string;
  description: string;
  notice: string;
  isActive: boolean;
  requiresReview: boolean;
  notifyLine: boolean;
  minAgeMonths: number | null;
  maxAgeMonths: number | null;
  allowedWeekdays: number[];
  allowedSessions: SessionPeriod[];
  doctorIds: string[];
  color: string;
  icon: string;
}

interface DoctorDto {
  id: string;
  name: string;
  title: string;
  isActive: boolean;
  displayOrder: number;
}

interface SettingsDto {
  openDays: number;
  openTime: string;
  sameDayCutoff: number;
  windowDays: number;
  windowMax: number;
  noShowThreshold: number;
  cancelCutoff: number;
  allowSameDay: boolean;
  sameDayReminder: boolean;
  dayBeforeTime: string;
  sameDayTime: string;
  idleMinutes: number;
}

export function SettingsManager({
  settings,
  clinicTypes,
  doctors,
  lineConfigured,
  smsProvider,
}: {
  settings: SettingsDto;
  clinicTypes: ClinicTypeDto[];
  doctors: DoctorDto[];
  lineConfigured: boolean;
  smsProvider: string;
}) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const saveRules = () =>
    startTransition(async () => {
      const r = await adminUpdateSettings([
        { key: "booking.open_days", value: s.openDays },
        { key: "booking.open_time", value: s.openTime },
        { key: "booking.same_day_cutoff_minutes", value: s.sameDayCutoff },
        { key: "booking.window_days", value: s.windowDays },
        { key: "booking.window_max", value: s.windowMax },
        { key: "booking.no_show_threshold", value: s.noShowThreshold },
        { key: "booking.cancel_cutoff_minutes", value: s.cancelCutoff },
        { key: "booking.allow_same_day", value: s.allowSameDay },
        { key: "notify.same_day_reminder", value: s.sameDayReminder },
        { key: "notify.day_before_time", value: s.dayBeforeTime },
        { key: "notify.same_day_time", value: s.sameDayTime },
        { key: "security.staff_idle_minutes", value: s.idleMinutes },
      ]);
      if (!r.ok) return setError(r.message);
      setError("");
      setMessage("設定已儲存，即時生效");
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}

      <Card className="space-y-3 max-w-3xl">
        <h2 className="font-bold text-forest-700">預約規則</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <NumField label="滾動開放天數（含今天）" value={s.openDays} onChange={(v) => setS({ ...s, openDays: v })} />
          <label className="block">
            <span className="text-sm text-stone-600">每日開放最新一天的時間</span>
            <input type="time" className="input" value={s.openTime} onChange={(e) => setS({ ...s, openTime: e.target.value })} />
          </label>
          <NumField label="7 天視窗天數" value={s.windowDays} onChange={(v) => setS({ ...s, windowDays: v })} />
          <NumField label="視窗內預約上限（筆）" value={s.windowMax} onChange={(v) => setS({ ...s, windowMax: v })} />
          <NumField label="未到限制門檻（超過 N 次自動限制）" value={s.noShowThreshold} onChange={(v) => setS({ ...s, noShowThreshold: v })} />
          <NumField label="當日預約截止（時段前 N 分鐘）" value={s.sameDayCutoff} onChange={(v) => setS({ ...s, sameDayCutoff: v })} />
          <NumField label="取消/改期截止（看診前 N 分鐘）" value={s.cancelCutoff} onChange={(v) => setS({ ...s, cancelCutoff: v })} />
          <NumField label="後台閒置自動登出（分鐘）" value={s.idleMinutes} onChange={(v) => setS({ ...s, idleMinutes: v })} />
          <label className="flex items-center gap-2 pt-5">
            <input type="checkbox" checked={s.allowSameDay} onChange={(e) => setS({ ...s, allowSameDay: e.target.checked })} className="size-4 accent-forest-600" />
            開放當日預約
          </label>
        </div>
        <h3 className="font-bold text-forest-700 pt-2">通知</h3>
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={s.sameDayReminder} onChange={(e) => setS({ ...s, sameDayReminder: e.target.checked })} className="size-4 accent-forest-600" />
            當日提醒
          </label>
          <label className="block">
            <span className="text-sm text-stone-600">前一日提醒時間</span>
            <input type="time" className="input" value={s.dayBeforeTime} onChange={(e) => setS({ ...s, dayBeforeTime: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-sm text-stone-600">當日提醒時間</span>
            <input type="time" className="input" value={s.sameDayTime} onChange={(e) => setS({ ...s, sameDayTime: e.target.value })} />
          </label>
        </div>
        <p className="text-sm text-stone-500">
          通知管道狀態：LINE 推播 {lineConfigured ? "✅ 已設定" : "—（未設定，將以簡訊替代）"}｜簡訊供應商：{smsProvider}
          （管道設定由環境變數管理，見部署說明）
        </p>
        <button onClick={saveRules} disabled={pending} className="btn-primary !py-2">
          儲存設定
        </button>
      </Card>

      <ClinicTypesEditor clinicTypes={clinicTypes} doctors={doctors} onError={setError} onDone={(m) => { setMessage(m); router.refresh(); }} />
      <DoctorsEditor doctors={doctors} onError={setError} onDone={(m) => { setMessage(m); router.refresh(); }} />
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-sm text-stone-600">{label}</span>
      <input type="number" className="input" value={value} min={0} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

function ClinicTypesEditor({
  clinicTypes,
  doctors,
  onError,
  onDone,
}: {
  clinicTypes: ClinicTypeDto[];
  doctors: DoctorDto[];
  onError: (m: string) => void;
  onDone: (m: string) => void;
}) {
  const [selected, setSelected] = useState<ClinicTypeDto | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (!selected) return;
    startTransition(async () => {
      const r = await adminUpdateClinicType({
        ...selected,
        description: selected.description || undefined,
        notice: selected.notice || undefined,
      });
      if (!r.ok) return onError(r.message);
      onDone(`「${selected.name}」設定已儲存`);
      setSelected(null);
    });
  };

  return (
    <Card className="space-y-3">
      <h2 className="font-bold text-forest-700">門診類型設定</h2>
      <div className="flex flex-wrap gap-2">
        {clinicTypes.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelected({ ...t })}
            className={`rounded-xl border-2 px-3 py-2 font-bold ${
              selected?.id === t.id ? "border-forest-600 bg-forest-600 text-white" : "border-cream-200 bg-white"
            } ${!t.isActive ? "opacity-50" : ""}`}
            style={selected?.id === t.id ? {} : { color: t.color }}
          >
            {t.name}
            {!t.isActive && "（停用）"}
          </button>
        ))}
      </div>

      {selected && (
        <div className="space-y-3 border-t border-cream-200 pt-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm text-stone-600">名稱</span>
              <input className="input" value={selected.name} onChange={(e) => setSelected({ ...selected, name: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-sm text-stone-600">顯示顏色</span>
              <input type="color" className="input !h-11" value={selected.color} onChange={(e) => setSelected({ ...selected, color: e.target.value })} />
            </label>
          </div>
          <label className="block">
            <span className="text-sm text-stone-600">預約說明</span>
            <input className="input" value={selected.description} onChange={(e) => setSelected({ ...selected, description: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-sm text-stone-600">預約前注意事項</span>
            <textarea className="input min-h-16" value={selected.notice} onChange={(e) => setSelected({ ...selected, notice: e.target.value })} />
          </label>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={selected.isActive} onChange={(e) => setSelected({ ...selected, isActive: e.target.checked })} className="size-4 accent-forest-600" />
              開放預約
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={selected.requiresReview} onChange={(e) => setSelected({ ...selected, requiresReview: e.target.checked })} className="size-4 accent-forest-600" />
              需櫃檯審核（成立為待確認）
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={selected.notifyLine} onChange={(e) => setSelected({ ...selected, notifyLine: e.target.checked })} className="size-4 accent-forest-600" />
              發送 LINE/簡訊通知
            </label>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm text-stone-600">年齡下限（月，空白＝不限）</span>
              <input type="number" className="input" value={selected.minAgeMonths ?? ""} min={0}
                onChange={(e) => setSelected({ ...selected, minAgeMonths: e.target.value === "" ? null : +e.target.value })} />
            </label>
            <label className="block">
              <span className="text-sm text-stone-600">年齡上限（月，空白＝不限）</span>
              <input type="number" className="input" value={selected.maxAgeMonths ?? ""} min={0}
                onChange={(e) => setSelected({ ...selected, maxAgeMonths: e.target.value === "" ? null : +e.target.value })} />
            </label>
          </div>
          <div>
            <span className="text-sm text-stone-600 block mb-1">可預約星期（全不勾＝依醫師班表）</span>
            <div className="flex gap-2 flex-wrap">
              {WEEKDAYS.map((w, i) => (
                <label key={i} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={selected.allowedWeekdays.includes(i)}
                    onChange={(e) =>
                      setSelected({
                        ...selected,
                        allowedWeekdays: e.target.checked
                          ? [...selected.allowedWeekdays, i]
                          : selected.allowedWeekdays.filter((x) => x !== i),
                      })
                    }
                    className="size-4 accent-forest-600"
                  />
                  週{w}
                </label>
              ))}
            </div>
          </div>
          <div>
            <span className="text-sm text-stone-600 block mb-1">可預約診別（全不勾＝全部）</span>
            <div className="flex gap-3">
              {(Object.keys(SESSION_META) as SessionPeriod[]).map((sess) => (
                <label key={sess} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={selected.allowedSessions.includes(sess)}
                    onChange={(e) =>
                      setSelected({
                        ...selected,
                        allowedSessions: e.target.checked
                          ? [...selected.allowedSessions, sess]
                          : selected.allowedSessions.filter((x) => x !== sess),
                      })
                    }
                    className="size-4 accent-forest-600"
                  />
                  {SESSION_META[sess].label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <span className="text-sm text-stone-600 block mb-1">可接受預約的醫師</span>
            <div className="flex gap-3 flex-wrap">
              {doctors.filter((d) => d.isActive).map((d) => (
                <label key={d.id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={selected.doctorIds.includes(d.id)}
                    onChange={(e) =>
                      setSelected({
                        ...selected,
                        doctorIds: e.target.checked
                          ? [...selected.doctorIds, d.id]
                          : selected.doctorIds.filter((x) => x !== d.id),
                      })
                    }
                    className="size-4 accent-forest-600"
                  />
                  {d.name}
                </label>
              ))}
            </div>
          </div>
          <button onClick={save} disabled={pending} className="btn-primary !py-2">
            儲存門診設定
          </button>
        </div>
      )}
    </Card>
  );
}

function DoctorsEditor({
  doctors,
  onError,
  onDone,
}: {
  doctors: DoctorDto[];
  onError: (m: string) => void;
  onDone: (m: string) => void;
}) {
  const [form, setForm] = useState({ id: "", name: "", title: "", isActive: true, displayOrder: doctors.length + 1 });
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const r = await adminUpsertDoctor({
        id: form.id || undefined,
        name: form.name,
        title: form.title || undefined,
        isActive: form.isActive,
        displayOrder: form.displayOrder,
      });
      if (!r.ok) return onError(r.message);
      onDone(form.id ? "醫師資料已更新" : "醫師已新增");
      setForm({ id: "", name: "", title: "", isActive: true, displayOrder: doctors.length + 2 });
    });

  return (
    <Card className="space-y-3">
      <h2 className="font-bold text-forest-700">醫師管理（可新增，不限兩位）</h2>
      <ul className="divide-y divide-cream-200">
        {doctors.map((d) => (
          <li key={d.id} className="py-2 flex items-center gap-3">
            <span className="font-bold">{d.name}</span>
            <span className="text-stone-500">{d.title}</span>
            <span className="text-sm text-stone-400">排序 {d.displayOrder}</span>
            {!d.isActive && <span className="text-sm text-red-700">已停用</span>}
            <button
              onClick={() => setForm({ id: d.id, name: d.name, title: d.title, isActive: d.isActive, displayOrder: d.displayOrder })}
              className="ml-auto text-forest-600 underline underline-offset-2 text-sm"
            >
              編輯
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 items-center border-t border-cream-200 pt-3">
        <input className="input !w-36" placeholder="姓名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input !w-36" placeholder="職稱" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <label className="flex items-center gap-1">
          排序
          <input type="number" className="input !w-16" value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: +e.target.value })} />
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="size-4 accent-forest-600" />
          啟用
        </label>
        <button onClick={save} disabled={pending || !form.name.trim()} className="btn-primary !py-2">
          {form.id ? "儲存" : "新增醫師"}
        </button>
        {form.id && (
          <button onClick={() => setForm({ id: "", name: "", title: "", isActive: true, displayOrder: doctors.length + 1 })} className="btn-secondary !py-2">
            取消
          </button>
        )}
      </div>
    </Card>
  );
}
