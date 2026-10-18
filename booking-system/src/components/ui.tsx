import type { AppointmentStatus } from "@prisma/client";
import { STATUS_META } from "@/lib/status-labels";

export function Card({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  /** 頁內錨點（例：/rules#missed-number） */
  id?: string;
}) {
  return (
    <div id={id} className={`rounded-2xl bg-white shadow-sm border border-sage-100 p-5 ${className}`}>
      {children}
    </div>
  );
}

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-medium ${meta.className}`}
    >
      <span aria-hidden>{meta.icon}</span>
      {meta.label}
    </span>
  );
}

/**
 * 立欣診所小鹿 LOGO（大鹿與小鹿，院長 2026-10-19 提供向量檔，與官網 images/logo.png 同一款）。
 * 取代原本內嵌的卡通小鹿佔位圖。檔案在 public/logo.svg，由院長給的 PDF 轉出、裁到圓框邊緣。
 * 一律放在診所名稱或標題旁，屬裝飾性圖片，故 alt 留空、不讓螢幕閱讀器重複唸。
 */
export function DeerMascot({ size = 56 }: { size?: number }) {
  return <img src="/logo.svg" width={size} height={size} alt="" aria-hidden className="shrink-0" />;
}

export function StepProgress({ current, total, labels }: { current: number; total: number; labels: string[] }) {
  return (
    <nav aria-label="預約進度" className="mb-6">
      <p className="text-sm text-wood-700 mb-2 font-medium">
        步驟 {current}／{total}：{labels[current - 1]}
      </p>
      <div className="flex gap-1.5" role="progressbar" aria-valuenow={current} aria-valuemin={1} aria-valuemax={total}>
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={`h-2 flex-1 rounded-full transition-colors ${
              i < current ? "bg-gradient-to-r from-sage-500 to-sage-300" : "bg-sage-100"
            }`}
          />
        ))}
      </div>
    </nav>
  );
}

export function Alert({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "error" | "success";
  children: React.ReactNode;
}) {
  const styles = {
    info: "bg-sage-50 border-sage-300 text-sage-800",
    warn: "bg-wood-100 border-wood-400 text-wood-700",
    error: "bg-rose-100 border-rose-300 text-rose-600",
    success: "bg-sage-100 border-sage-300 text-sage-800",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-[0.95rem] ${styles}`}>
      {children}
    </div>
  );
}
