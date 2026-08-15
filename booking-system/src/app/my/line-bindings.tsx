"use client";

/**
 * LINE 綁定的家庭成員：列出已綁定者、產生櫃檯綁定代碼、解除綁定。
 *
 * 這裡**沒有**自助綁定既有病歷的功能（院長 2026-08-15 裁示）。
 * 綁定等於取得該病人全部預約紀錄的讀取權，只憑填得出證件號、生日、手機就給，
 * 等於讓知道這三項的人冒用證件綁走病歷身分——核對身分這件事只有櫃檯做得到。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { issueBindingCode, unbindFamilyMember, type LineBindingDto } from "@/app/actions/portal";
import { Card, Alert } from "@/components/ui";
import { CLINIC } from "@/lib/clinic-info";

export function LineBindings({ initial }: { initial: LineBindingDto[] }) {
  const router = useRouter();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const getCode = () => {
    startTransition(async () => {
      const r = await issueBindingCode();
      if (!r.ok) return setError(r.message);
      setError("");
      setCode(r.data!);
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
      <h2 className="font-bold text-sage-700 text-lg">LINE 綁定的家庭成員</h2>
      {error && <Alert tone="error">{error}</Alert>}

      {initial.length === 0 && (
        <p className="text-ink-700 text-sm">
          尚未綁定任何看診成員。線上預約成立時會自動綁定該位病人；
          先前已在本院看診過的家人，請依下方說明到櫃檯完成綁定。
        </p>
      )}
      {initial.length > 0 && (
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
      )}

      <div className="border-t border-sage-200 pt-3 space-y-3">
        <div>
          <h3 className="font-bold text-sage-700">要加入先前看診過的家人？</h3>
          <p className="text-sm text-ink-700 mt-1">
            為保護病人資料，已建檔的病歷需由櫃檯核對身分後才能綁定。
            請按下方按鈕取得綁定代碼，看診當天<strong>攜帶該位家人的健保卡到櫃檯</strong>並告知代碼；
            也可致電 {CLINIC.phone} 詢問。
          </p>
        </div>

        {code ? (
          <div className="rounded-xl border-2 border-sage-500 bg-sage-500/10 p-4 text-center space-y-1">
            <p className="text-sm text-ink-700">請告知櫃檯這組代碼</p>
            <p className="text-4xl font-mono font-bold tracking-[0.3em] text-sage-700">
              {code.code}
            </p>
            <p className="text-sm text-ink-500">
              {new Date(code.expiresAt).toLocaleTimeString("zh-TW", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              前有效，僅能使用一次
            </p>
            <button
              onClick={getCode}
              disabled={pending}
              className="text-sm text-ink-500 underline underline-offset-2"
            >
              重新產生（舊代碼作廢）
            </button>
          </div>
        ) : (
          <button onClick={getCode} disabled={pending} className="btn-secondary w-full">
            {pending ? "產生中…" : "取得櫃檯綁定代碼"}
          </button>
        )}
      </div>
    </Card>
  );
}
