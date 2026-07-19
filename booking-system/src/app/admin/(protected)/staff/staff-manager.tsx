"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { adminUpsertStaffUser, adminSetupTotp, adminConfirmTotp } from "@/app/actions/admin";
import { Card, Alert } from "@/components/ui";

const ROLE_LABEL = { ADMIN: "系統管理員", STAFF: "櫃檯人員", DOCTOR_READONLY: "醫師唯讀" } as const;
type RoleCode = keyof typeof ROLE_LABEL;

interface UserDto {
  id: string;
  username: string;
  displayName: string;
  roleCode: RoleCode;
  roleName: string;
  doctorId: string | null;
  doctorName: string | null;
  isActive: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
}

export function StaffManager({
  users,
  doctors,
  selfId,
  selfTotpEnabled,
}: {
  users: UserDto[];
  doctors: { id: string; name: string }[];
  selfId: string;
  selfTotpEnabled: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [form, setForm] = useState({
    username: "",
    displayName: "",
    password: "",
    roleCode: "STAFF" as RoleCode,
    doctorId: "",
    isActive: true,
  });
  const [totpQr, setTotpQr] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");

  const startEdit = (u: UserDto | null) => {
    setEditing(u);
    setForm(
      u
        ? {
            username: u.username,
            displayName: u.displayName,
            password: "",
            roleCode: u.roleCode,
            doctorId: u.doctorId ?? "",
            isActive: u.isActive,
          }
        : { username: "", displayName: "", password: "", roleCode: "STAFF", doctorId: "", isActive: true },
    );
  };

  const save = () => {
    startTransition(async () => {
      const r = await adminUpsertStaffUser({
        id: editing?.id,
        username: form.username,
        displayName: form.displayName,
        password: form.password || undefined,
        roleCode: form.roleCode,
        doctorId: form.doctorId || undefined,
        isActive: form.isActive,
      });
      if (!r.ok) return setError(r.message);
      setError("");
      setMessage(editing ? "帳號已更新" : "帳號已建立");
      setEditing(null);
      startEdit(null);
      router.refresh();
    });
  };

  const setupTotp = () => {
    startTransition(async () => {
      const r = await adminSetupTotp();
      if (!r.ok) return setError(r.message);
      const dataUrl = await QRCode.toDataURL(r.data!.otpauth, { width: 220 });
      setTotpQr(dataUrl);
    });
  };

  const confirmTotp = () => {
    startTransition(async () => {
      const r = await adminConfirmTotp(totpCode);
      if (!r.ok) return setError(r.message);
      setTotpQr(null);
      setMessage("兩步驟驗證已啟用，下次登入生效");
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-stone-500">
              <th className="py-1.5 pr-3">帳號</th>
              <th className="pr-3">姓名</th>
              <th className="pr-3">角色</th>
              <th className="pr-3">對應醫師</th>
              <th className="pr-3">2FA</th>
              <th className="pr-3">狀態</th>
              <th className="pr-3">最近登入</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-cream-200">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="py-2 pr-3 font-mono">{u.username}</td>
                <td className="pr-3 font-bold">{u.displayName}{u.id === selfId && "（自己）"}</td>
                <td className="pr-3">{ROLE_LABEL[u.roleCode] ?? u.roleName}</td>
                <td className="pr-3">{u.doctorName ?? "—"}</td>
                <td className="pr-3">{u.totpEnabled ? "✅" : "—"}</td>
                <td className="pr-3">{u.isActive ? "啟用" : "停用"}</td>
                <td className="pr-3 text-stone-500">{u.lastLoginAt ?? "—"}</td>
                <td>
                  <button onClick={() => startEdit(u)} className="text-forest-600 underline underline-offset-2">
                    編輯
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="space-y-3 max-w-2xl">
        <h2 className="font-bold text-forest-700">{editing ? `編輯：${editing.username}` : "新增員工帳號"}</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <input className="input" placeholder="登入帳號（英數字）" value={form.username} disabled={!!editing}
            onChange={(e) => setForm({ ...form, username: e.target.value.trim() })} />
          <input className="input" placeholder="顯示姓名" value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          <input className="input" type="password" placeholder={editing ? "重設密碼（留空不變）" : "密碼（至少 10 字元）"}
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
          <select className="input" value={form.roleCode} onChange={(e) => setForm({ ...form, roleCode: e.target.value as RoleCode })}>
            {Object.entries(ROLE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          {form.roleCode === "DOCTOR_READONLY" && (
            <select className="input" value={form.doctorId} onChange={(e) => setForm({ ...form, doctorId: e.target.value })}>
              <option value="">選擇對應醫師</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="size-4 accent-forest-600" />
            啟用
          </label>
        </div>
        <div className="flex gap-2">
          <button onClick={save} disabled={pending || !form.username || !form.displayName} className="btn-primary !py-2">
            {editing ? "儲存變更" : "建立帳號"}
          </button>
          {editing && (
            <button onClick={() => startEdit(null)} className="btn-secondary !py-2">
              取消編輯
            </button>
          )}
        </div>
      </Card>

      <Card className="space-y-3 max-w-2xl">
        <h2 className="font-bold text-forest-700">我的兩步驟驗證（TOTP）</h2>
        {selfTotpEnabled && !totpQr ? (
          <p className="text-forest-600">✅ 已啟用。登入時需輸入驗證器 App 的 6 位數驗證碼。</p>
        ) : totpQr ? (
          <div className="space-y-2">
            <p className="text-stone-700">
              請用 Google Authenticator／Microsoft Authenticator 掃描 QR code，然後輸入顯示的 6 位數完成啟用：
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={totpQr} alt="TOTP QR code" className="rounded-xl border border-cream-200" />
            <div className="flex gap-2">
              <input className="input !w-40 text-center tracking-widest" inputMode="numeric" maxLength={6}
                value={totpCode} onChange={(e) => setTotpCode(e.target.value.trim())} />
              <button onClick={confirmTotp} disabled={pending || totpCode.length !== 6} className="btn-primary !py-2">
                確認啟用
              </button>
            </div>
          </div>
        ) : (
          <button onClick={setupTotp} disabled={pending} className="btn-secondary !py-2">
            {selfTotpEnabled ? "重新設定" : "啟用兩步驟驗證"}
          </button>
        )}
      </Card>
    </div>
  );
}
