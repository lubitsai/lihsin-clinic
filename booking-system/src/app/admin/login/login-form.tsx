"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { staffLogin, staffTotpLogin } from "@/app/actions/admin";
import { Card, Alert } from "@/components/ui";

export function StaffLoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const login = () => {
    startTransition(async () => {
      const r = await staffLogin(username.trim(), password);
      if (!r.ok) return setError(r.message);
      if (r.data?.needsTotp) {
        setPendingToken(r.data.pendingToken!);
        setError("");
        return;
      }
      router.replace("/admin");
    });
  };

  const verifyTotp = () => {
    if (!pendingToken) return;
    startTransition(async () => {
      const r = await staffTotpLogin(pendingToken, totpCode);
      if (!r.ok) return setError(r.message);
      router.replace("/admin");
    });
  };

  return (
    <Card className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {!pendingToken ? (
        <>
          <label className="block">
            <span className="block text-sm font-medium text-stone-700 mb-1">帳號</span>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-stone-700 mb-1">密碼</span>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              onKeyDown={(e) => e.key === "Enter" && login()}
            />
          </label>
          <button onClick={login} disabled={pending || !username || !password} className="btn-primary w-full">
            {pending ? "登入中…" : "登入"}
          </button>
        </>
      ) : (
        <>
          <p className="text-stone-700">請輸入驗證器 App 顯示的 6 位數驗證碼（兩步驟驗證）</p>
          <input
            className="input text-center text-2xl tracking-widest"
            inputMode="numeric"
            maxLength={6}
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value.trim())}
            onKeyDown={(e) => e.key === "Enter" && verifyTotp()}
            autoFocus
          />
          <button onClick={verifyTotp} disabled={pending || totpCode.length !== 6} className="btn-primary w-full">
            驗證
          </button>
        </>
      )}
    </Card>
  );
}
