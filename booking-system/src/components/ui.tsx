import type { AppointmentStatus } from "@prisma/client";
import { STATUS_META } from "@/lib/status-labels";

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-card bg-white shadow-sm border border-cream-200 p-5 ${className}`}>
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

/** 小鹿醫師：品牌吉祥物（內嵌 SVG 佔位；正式 LOGO 圖檔可替換 public/logo.png） */
export function DeerMascot({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
      <circle cx="32" cy="34" r="26" fill="#f3ead6" />
      <path d="M18 14c-3-5-8-6-8-6s1 7 5 9" stroke="#8b5e3c" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M46 14c3-5 8-6 8-6s-1 7-5 9" stroke="#8b5e3c" strokeWidth="3" fill="none" strokeLinecap="round" />
      <ellipse cx="32" cy="36" rx="17" ry="16" fill="#a97c50" />
      <ellipse cx="32" cy="42" rx="10" ry="8" fill="#f9f3e3" />
      <circle cx="25" cy="32" r="2.6" fill="#2d2a24" />
      <circle cx="39" cy="32" r="2.6" fill="#2d2a24" />
      <ellipse cx="32" cy="40" rx="3.4" ry="2.6" fill="#6f4a2f" />
      <path d="M28 46c2.5 2 5.5 2 8 0" stroke="#6f4a2f" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <ellipse cx="20" cy="21" rx="4" ry="6" fill="#a97c50" transform="rotate(-20 20 21)" />
      <ellipse cx="44" cy="21" rx="4" ry="6" fill="#a97c50" transform="rotate(20 44 21)" />
      <rect x="26" y="52" width="12" height="8" rx="2" fill="#3d7a4e" />
      <path d="M30 56h4M32 54v4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function StepProgress({ current, total, labels }: { current: number; total: number; labels: string[] }) {
  return (
    <nav aria-label="預約進度" className="mb-6">
      <p className="text-sm text-bark-600 mb-2 font-medium">
        步驟 {current}／{total}：{labels[current - 1]}
      </p>
      <div className="flex gap-1.5" role="progressbar" aria-valuenow={current} aria-valuemin={1} aria-valuemax={total}>
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={`h-2 flex-1 rounded-full ${i < current ? "bg-forest-500" : "bg-cream-200"}`}
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
    info: "bg-sky-50 border-sky-300 text-sky-900",
    warn: "bg-amber-50 border-amber-300 text-amber-900",
    error: "bg-red-50 border-red-300 text-red-900",
    success: "bg-forest-500/10 border-forest-500/40 text-forest-700",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-[0.95rem] ${styles}`}>
      {children}
    </div>
  );
}
