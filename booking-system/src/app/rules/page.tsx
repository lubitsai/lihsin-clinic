import Link from "next/link";
import { Card } from "@/components/ui";
import { CLINIC } from "@/lib/clinic-info";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "預約規則與個資告知" };

export default async function RulesPage() {
  const [openDays, windowDays, windowMax, cancelCutoff] = await Promise.all([
    getSetting("booking.open_days"),
    getSetting("booking.window_days"),
    getSetting("booking.window_max"),
    getSetting("booking.cancel_cutoff_minutes"),
  ]);
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 space-y-5">
      <h1 className="text-2xl font-bold text-forest-700">預約規則與個人資料告知</h1>

      <Card className="space-y-3">
        <h2 className="text-lg font-bold text-forest-700">預約規則</h2>
        <ul className="list-disc list-inside space-y-1.5 text-stone-700 leading-relaxed">
          <li>開放預約範圍：今日起 {openDays} 天內（每日 00:00 開放最新一天）。</li>
          <li>同一位病人同一天僅能有 1 筆有效預約（不分醫師、門診類型）。</li>
          <li>為維護公平性，每位病人任意連續 {windowDays} 天內最多預約 {windowMax} 個時段。</li>
          <li>取消或改期請於看診前 {cancelCutoff >= 60 ? `${cancelCutoff / 60} 小時` : `${cancelCutoff} 分鐘`}完成；逾時請致電診所。</li>
          <li>多次預約未到且未事先取消者，將暫停線上預約服務，需致電診所由櫃檯協助。</li>
          <li>線上預約為看診時段登記，非實際看診號碼；請依現場報到順序候診。</li>
          <li>特別門診（兒童發展篩檢、減重、過敏）可能需櫃檯確認後才成立，確認結果將以 LINE 或簡訊通知。</li>
        </ul>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-bold text-forest-700">個人資料蒐集告知（個資法第 8 條）</h2>
        <div className="text-stone-700 leading-relaxed space-y-2">
          <p>
            {CLINIC.name}（以下稱本診所）為辦理門診預約、掛號、就診通知與醫療服務之目的
            （特定目的：醫療業務、掛號管理、行銷以外之聯繫），蒐集您填寫的姓名、出生日期、
            證件號碼、聯絡電話及 LINE 帳號識別碼。
          </p>
          <p>
            上述資料僅於預約與就診相關作業使用，於法定醫療紀錄保存期限內保存於本診所自行管理之系統，
            不會提供予無關之第三人。證件號碼以加密方式儲存，顯示時一律遮罩。
          </p>
          <p>
            您得依個資法第 3 條行使查詢、閱覽、補充、更正、停止蒐集處理利用及刪除之權利，
            請致電 {CLINIC.phone} 由專人協助。若不提供必要資料，將無法完成線上預約，
            仍可致電或現場掛號。
          </p>
          <p>送出預約即表示您已閱讀並同意上述告知事項。</p>
        </div>
      </Card>

      <p className="text-center">
        <Link href="/" className="text-forest-600 underline underline-offset-2">
          回預約首頁
        </Link>
      </p>
    </main>
  );
}
