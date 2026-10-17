import { ErrorScreen } from "@/components/error-screen";
import { CLINIC } from "@/lib/clinic-info";

export const metadata = { title: "找不到這個頁面" };

/** 網址打錯或頁面已移除（前台文字見 docs/08 §七之六 7-6-1～7-6-3） */
export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-sage-50">
      <ErrorScreen title="找不到這個頁面" homeHref="/" homeLabel="回預約首頁">
        <p>網址可能有誤，或這個頁面已經移除。</p>
        <p className="mt-2 text-sm">
          需要協助請致電
          <a href={CLINIC.phoneHref} className="text-sage-600 font-bold underline underline-offset-2 ml-1">
            {CLINIC.phone}
          </a>
          。
        </p>
      </ErrorScreen>
    </div>
  );
}
