"use client";

/**
 * 排班管理：固定週班表編輯＋日期例外（休診/代診/加診/封鎖/加開名額）。
 * 建立例外若影響既有預約：先顯示受影響病人名單，
 * 由櫃檯選擇「逐筆改期（前往改期頁）」或「批次診所取消＋通知」後才生效。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  adminUpsertTemplate,
  adminDeleteTemplate,
  adminCreateException,
  adminPreviewException,
  adminDeleteException,
  adminSetSlotCapacity,
} from "@/app/actions/admin";
import { Card, Alert } from "@/components/ui";
import { formatDateTw, todayStr } from "@/lib/tw-time";
import { SESSION_META } from "@/lib/status-labels";
import type { SessionPeriod, ExceptionType } from "@prisma/client";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const SESSIONS: SessionPeriod[] = ["MORNING", "AFTERNOON", "EVENING"];

const EXCEPTION_LABEL: Record<ExceptionType, string> = {
  CLINIC_CLOSED_DAY: "全日休診",
  SESSION_CLOSED: "單一診別休診",
  DOCTOR_OFF: "醫師休診",
  DOCTOR_SUBSTITUTE: "醫師代診",
  SPECIAL_HOURS: "特殊營業時間",
  EXTRA_SESSION: "臨時加診",
  SLOT_BLOCKED: "封鎖單一時段",
  CLINIC_TYPE_SUSPENDED: "暫停門診類型",
};

interface TemplateDto {
  id: string;
  weekday: number;
  session: SessionPeriod;
  startTime: string;
  endTime: string;
  doctorId: string;
  doctorName: string;
  slotCapacity: number;
  allowOnline: boolean;
  isActive: boolean;
}

interface ExceptionDto {
  id: string;
  date: string;
  type: ExceptionType;
  session: SessionPeriod | null;
  doctorId: string | null;
  substituteDoctorId: string | null;
  startTime: string | null;
  endTime: string | null;
  reason: string;
}

interface Props {
  templates: TemplateDto[];
  exceptions: ExceptionDto[];
  doctors: { id: string; name: string }[];
  clinicTypes: { id: string; name: string }[];
}

export function ScheduleManager({ templates, exceptions, doctors, clinicTypes }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"weekly" | "exceptions" | "capacity">("weekly");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const doctorName = (id: string | null) => doctors.find((d) => d.id === id)?.name ?? "全部";

  return (
    <div className="space-y-4">
      <div className="flex gap-2 no-print">
        {(
          [
            ["weekly", "固定週班表"],
            ["exceptions", "日期例外（休診/代診/加診）"],
            ["capacity", "時段名額調整"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-xl border-2 px-4 py-2 font-bold ${
              tab === key ? "border-forest-600 bg-forest-600 text-white" : "border-cream-200 bg-white text-stone-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}

      {tab === "weekly" && (
        <WeeklyEditor
          templates={templates}
          doctors={doctors}
          pending={pending}
          onSave={(input) =>
            startTransition(async () => {
              const r = await adminUpsertTemplate(input);
              if (!r.ok) return setError(r.message);
              setError("");
              setMessage("班表已儲存");
              router.refresh();
            })
          }
          onDelete={(id) =>
            startTransition(async () => {
              if (!window.confirm("確定刪除此班表段落？")) return;
              const r = await adminDeleteTemplate(id);
              if (!r.ok) return setError(r.message);
              router.refresh();
            })
          }
        />
      )}

      {tab === "exceptions" && (
        <ExceptionEditor
          exceptions={exceptions}
          doctors={doctors}
          clinicTypes={clinicTypes}
          pending={pending}
          doctorName={doctorName}
          onDelete={(id) =>
            startTransition(async () => {
              if (!window.confirm("確定刪除此例外設定？")) return;
              const r = await adminDeleteException(id);
              if (!r.ok) return setError(r.message);
              router.refresh();
            })
          }
          onError={setError}
          onDone={(msg) => {
            setError("");
            setMessage(msg);
            router.refresh();
          }}
        />
      )}

      {tab === "capacity" && (
        <CapacityEditor
          doctors={doctors}
          pending={pending}
          onSave={(input) =>
            startTransition(async () => {
              const r = await adminSetSlotCapacity(input);
              if (!r.ok) return setError(r.message);
              setError("");
              setMessage(`已調整 ${formatDateTw(input.date)} ${input.startTime} 的名額為 ${input.capacity}`);
            })
          }
        />
      )}
    </div>
  );
}

function WeeklyEditor({
  templates,
  doctors,
  pending,
  onSave,
  onDelete,
}: {
  templates: TemplateDto[];
  doctors: { id: string; name: string }[];
  pending: boolean;
  onSave: (input: {
    weekday: number;
    session: SessionPeriod;
    startTime: string;
    endTime: string;
    doctorId: string;
    slotCapacity: number;
    allowOnline: boolean;
    isActive: boolean;
  }) => void;
  onDelete: (id: string) => void;
}) {
  const [form, setForm] = useState({
    weekday: 1,
    session: "MORNING" as SessionPeriod,
    startTime: "08:00",
    endTime: "12:00",
    doctorId: doctors[0]?.id ?? "",
    slotCapacity: 1,
    allowOnline: true,
    isActive: true,
  });

  return (
    <div className="space-y-4">
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-stone-500">
              <th className="py-1.5 pr-3">星期</th>
              <th className="pr-3">診別</th>
              <th className="pr-3">時間</th>
              <th className="pr-3">醫師</th>
              <th className="pr-3">每30分名額</th>
              <th className="pr-3">線上開放</th>
              <th className="pr-3">啟用</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-cream-200">
            {templates.map((t) => (
              <tr key={t.id}>
                <td className="py-2 pr-3 font-bold">週{WEEKDAYS[t.weekday]}</td>
                <td className="pr-3">{SESSION_META[t.session].label}</td>
                <td className="pr-3 font-mono">
                  {t.startTime}–{t.endTime}
                </td>
                <td className="pr-3">{t.doctorName}</td>
                <td className="pr-3 text-center">{t.slotCapacity}</td>
                <td className="pr-3">{t.allowOnline ? "✅" : "—"}</td>
                <td className="pr-3">{t.isActive ? "✅" : "停用"}</td>
                <td>
                  <button onClick={() => onDelete(t.id)} disabled={pending} className="text-red-700 underline underline-offset-2">
                    刪除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="space-y-3">
        <h3 className="font-bold text-forest-700">新增／覆蓋班表段落（同星期＋診別＋醫師會覆蓋）</h3>
        <div className="flex flex-wrap gap-2 items-center">
          <select className="input !w-auto" value={form.weekday} onChange={(e) => setForm({ ...form, weekday: +e.target.value })}>
            {WEEKDAYS.map((w, i) => (
              <option key={i} value={i}>週{w}</option>
            ))}
          </select>
          <select className="input !w-auto" value={form.session} onChange={(e) => setForm({ ...form, session: e.target.value as SessionPeriod })}>
            {SESSIONS.map((s) => (
              <option key={s} value={s}>{SESSION_META[s].label}</option>
            ))}
          </select>
          <input type="time" step={1800} className="input !w-auto" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
          <span>–</span>
          <input type="time" step={1800} className="input !w-auto" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
          <select className="input !w-auto" value={form.doctorId} onChange={(e) => setForm({ ...form, doctorId: e.target.value })}>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <label className="flex items-center gap-1">
            名額
            <input type="number" min={1} max={10} className="input !w-16" value={form.slotCapacity} onChange={(e) => setForm({ ...form, slotCapacity: +e.target.value })} />
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={form.allowOnline} onChange={(e) => setForm({ ...form, allowOnline: e.target.checked })} className="size-4 accent-forest-600" />
            線上開放
          </label>
          <button onClick={() => onSave(form)} disabled={pending} className="btn-primary !py-2">
            儲存
          </button>
        </div>
        <p className="text-sm text-stone-500">
          預設營業時間：週一–五 08:00–12:00／14:30–18:00／18:30–21:30；週六 08:00–11:30／14:30–18:00；週日 08:00–11:30／18:30–21:00。
        </p>
      </Card>
    </div>
  );
}

function ExceptionEditor({
  exceptions,
  doctors,
  clinicTypes,
  pending,
  doctorName,
  onDelete,
  onError,
  onDone,
}: {
  exceptions: ExceptionDto[];
  doctors: { id: string; name: string }[];
  clinicTypes: { id: string; name: string }[];
  pending: boolean;
  doctorName: (id: string | null) => string;
  onDelete: (id: string) => void;
  onError: (message: string) => void;
  onDone: (message: string) => void;
}) {
  const [, startTransition] = useTransition();
  const [form, setForm] = useState({
    date: todayStr(),
    type: "CLINIC_CLOSED_DAY" as ExceptionType,
    session: "" as "" | SessionPeriod,
    doctorId: "",
    substituteDoctorId: "",
    startTime: "",
    endTime: "",
    clinicTypeId: "",
    reason: "",
  });
  const [affected, setAffected] = useState<
    { id: string; bookingNumber: string; time: string; patientName: string; phone: string }[] | null
  >(null);

  const buildInput = () => ({
    date: form.date,
    type: form.type,
    session: form.session || undefined,
    doctorId: form.doctorId || undefined,
    substituteDoctorId: form.substituteDoctorId || undefined,
    startTime: form.startTime || undefined,
    endTime: form.endTime || undefined,
    clinicTypeId: form.clinicTypeId || undefined,
    reason: form.reason,
  });

  const preview = () => {
    startTransition(async () => {
      const r = await adminPreviewException(buildInput());
      if (!r.ok) return onError(r.message);
      setAffected(r.data?.affected ?? []);
      if ((r.data?.affected.length ?? 0) === 0) {
        // 無受影響預約 → 直接建立
        const created = await adminCreateException(buildInput());
        if (!created.ok) return onError(created.message);
        setAffected(null);
        onDone("例外設定已生效");
      }
    });
  };

  const applyWithCancel = () => {
    if (!window.confirm(`將以「診所取消」處理 ${affected?.length} 筆預約並發送通知，確定？`)) return;
    startTransition(async () => {
      const r = await adminCreateException(buildInput(), {
        cancelAffected: true,
        cancelReason: form.reason,
      });
      if (!r.ok) return onError(r.message);
      setAffected(null);
      onDone("已取消受影響預約、發送通知，例外設定生效");
    });
  };

  const needsSession = ["SESSION_CLOSED", "SPECIAL_HOURS", "EXTRA_SESSION"].includes(form.type);
  const needsDoctor = ["DOCTOR_OFF", "DOCTOR_SUBSTITUTE", "EXTRA_SESSION", "SLOT_BLOCKED"].includes(form.type);
  const needsTime = ["SPECIAL_HOURS", "EXTRA_SESSION", "SLOT_BLOCKED"].includes(form.type);

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h3 className="font-bold text-forest-700">新增日期例外</h3>
        <div className="flex flex-wrap gap-2 items-center">
          <input type="date" className="input !w-auto" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <select className="input !w-auto" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as ExceptionType })}>
            {Object.entries(EXCEPTION_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          {needsSession && (
            <select className="input !w-auto" value={form.session} onChange={(e) => setForm({ ...form, session: e.target.value as SessionPeriod | "" })}>
              <option value="">選擇診別</option>
              {SESSIONS.map((s) => (
                <option key={s} value={s}>{SESSION_META[s].label}</option>
              ))}
            </select>
          )}
          {needsDoctor && (
            <select className="input !w-auto" value={form.doctorId} onChange={(e) => setForm({ ...form, doctorId: e.target.value })}>
              <option value="">選擇醫師</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}
          {form.type === "DOCTOR_SUBSTITUTE" && (
            <select className="input !w-auto" value={form.substituteDoctorId} onChange={(e) => setForm({ ...form, substituteDoctorId: e.target.value })}>
              <option value="">代診醫師</option>
              {doctors.filter((d) => d.id !== form.doctorId).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}
          {form.type === "CLINIC_TYPE_SUSPENDED" && (
            <select className="input !w-auto" value={form.clinicTypeId} onChange={(e) => setForm({ ...form, clinicTypeId: e.target.value })}>
              <option value="">選擇門診類型</option>
              {clinicTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          {needsTime && (
            <>
              <input type="time" step={1800} className="input !w-auto" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
              {form.type !== "SLOT_BLOCKED" && (
                <>
                  <span>–</span>
                  <input type="time" step={1800} className="input !w-auto" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
                </>
              )}
            </>
          )}
        </div>
        <input
          className="input"
          placeholder="原因（必填，會顯示於前台公告與通知）"
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
        <button onClick={preview} disabled={pending || !form.reason.trim()} className="btn-primary !py-2">
          檢查影響並套用
        </button>
      </Card>

      {affected && affected.length > 0 && (
        <Card className="border-persimmon-500/50 space-y-3">
          <h3 className="font-bold text-persimmon-600">
            ⚠️ 此變更影響 {affected.length} 筆有效預約（不會直接刪除，請選擇處理方式）
          </h3>
          <ul className="divide-y divide-cream-200">
            {affected.map((a) => (
              <li key={a.id} className="py-2 flex flex-wrap items-center gap-2">
                <span className="font-mono">{a.time}</span>
                <span className="font-bold">{a.patientName}</span>
                <span className="text-stone-500">{a.phone}</span>
                <span className="text-stone-400 text-sm">{a.bookingNumber}</span>
                <Link href={`/admin/booking?reschedule=${a.id}`} className="ml-auto qbtn bg-bark-500 text-white">
                  逐筆改期
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button onClick={applyWithCancel} disabled={pending} className="btn-danger">
              批次診所取消＋通知，並套用例外
            </button>
            <button onClick={() => setAffected(null)} className="btn-secondary">
              先不套用
            </button>
          </div>
        </Card>
      )}

      <Card>
        <h3 className="font-bold text-forest-700 mb-2">已設定的例外（今日起）</h3>
        <ul className="divide-y divide-cream-200">
          {exceptions.length === 0 && <li className="py-2 text-stone-500">目前沒有例外設定。</li>}
          {exceptions.map((e) => (
            <li key={e.id} className="py-2 flex flex-wrap items-center gap-2">
              <span className="font-bold">{formatDateTw(e.date)}</span>
              <span className="rounded bg-cream-200 px-2 py-0.5 text-sm">{EXCEPTION_LABEL[e.type]}</span>
              {e.session && <span>{SESSION_META[e.session].label}</span>}
              {e.doctorId && <span>{doctorName(e.doctorId)}醫師</span>}
              {e.substituteDoctorId && <span>→ {doctorName(e.substituteDoctorId)}醫師代診</span>}
              {e.startTime && (
                <span className="font-mono">
                  {e.startTime}
                  {e.endTime ? `–${e.endTime}` : ""}
                </span>
              )}
              <span className="text-stone-500">{e.reason}</span>
              <button onClick={() => onDelete(e.id)} disabled={pending} className="ml-auto text-red-700 underline underline-offset-2 text-sm">
                刪除
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function CapacityEditor({
  doctors,
  pending,
  onSave,
}: {
  doctors: { id: string; name: string }[];
  pending: boolean;
  onSave: (input: { doctorId: string; date: string; startTime: string; capacity: number; reason: string }) => void;
}) {
  const [form, setForm] = useState({
    doctorId: doctors[0]?.id ?? "",
    date: todayStr(),
    startTime: "08:00",
    capacity: 2,
    reason: "",
  });
  return (
    <Card className="space-y-3">
      <h3 className="font-bold text-forest-700">手動調整單一時段名額（加開特殊名額）</h3>
      <p className="text-sm text-stone-500">操作者、時間與原因將寫入稽核紀錄。</p>
      <div className="flex flex-wrap gap-2 items-center">
        <select className="input !w-auto" value={form.doctorId} onChange={(e) => setForm({ ...form, doctorId: e.target.value })}>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <input type="date" className="input !w-auto" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <input type="time" step={1800} className="input !w-auto" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
        <label className="flex items-center gap-1">
          名額
          <input type="number" min={1} max={10} className="input !w-16" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: +e.target.value })} />
        </label>
      </div>
      <input className="input" placeholder="原因（必填）" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
      <button onClick={() => onSave(form)} disabled={pending || !form.reason.trim()} className="btn-primary !py-2">
        套用名額
      </button>
    </Card>
  );
}
