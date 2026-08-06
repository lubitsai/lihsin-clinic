import Link from "next/link";
import { Card } from "@/components/ui";
import { CLINIC } from "@/lib/clinic-info";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "預約規則與個資告知" };

/**
 * 預約規則頁。
 * 文字依院長 2026-07-31 核可、已上站的官網公告（visit-guide.html#booking-rules）撰寫，
 * 段落順序照家長動線：預約不等於掛號 → 何時能約 → 報到 → 取消改期 → 額度 → 特殊門診。
 * 與公告唯一不同處已記於 docs/09：額度超過時系統「當下擋下」，不事後自動取消。
 */
export default async function RulesPage() {
  const [openDays, activeMax, leadMinutes, grace, noShowThreshold, suspensionDays] =
    await Promise.all([
      getSetting("booking.open_days"),
      getSetting("booking.active_max"),
      getSetting("booking.same_day_cutoff_minutes"),
      getSetting("booking.checkin_grace_minutes"),
      getSetting("booking.no_show_threshold"),
      getSetting("booking.no_show_suspension_days"),
    ]);
  const leadHours = leadMinutes % 60 === 0 ? `${leadMinutes / 60} 小時` : `${leadMinutes} 分鐘`;
  const suspensionText =
    suspensionDays % 30 === 0 ? `${suspensionDays / 30} 個月` : `${suspensionDays} 天`;

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-sage-50">
      <div className="mx-auto max-w-2xl px-4 py-8 space-y-5">
        <h1 className="text-2xl font-bold text-sage-700">預約規則與個人資料告知</h1>

        <Card className="space-y-2">
          <h2 className="text-lg font-bold text-sage-700">完成網路預約，還不算完成掛號</h2>
          <p className="text-ink-900 leading-relaxed">
            本院採網路時段預約，每 30 分鐘為一個時段、每個時段一組名額。網路上完成預約是先保留該時段的名額，
            <strong>到診所櫃檯完成報到後才算正式掛號</strong>。看診時預約號與現場號交錯叫號，
            預約號會在該時段內依序安排，遇特殊狀況可能順延。
          </p>
        </Card>

        <Card className="space-y-2">
          <h2 className="text-lg font-bold text-sage-700">什麼時候可以約</h2>
          <ul className="list-disc list-inside space-y-1.5 text-ink-900 leading-relaxed">
            <li>每日 00:00 釋出第 {openDays} 天的時段，可預約範圍為未來 {openDays} 天內。</li>
            <li>
              網路預約請在<strong>該時段開始的 {leadHours}前</strong>完成。
            </li>
            <li>
              距離不足 {leadHours}：請在<strong>該診次開診前</strong>來電，由櫃檯協助預約。
              電話在門診時間才有人接聽，因此要用電話預約隔天早診，請在
              <strong>前一日最後一診結束前</strong>撥打（週六最後一診至 18:00）。
            </li>
            <li>
              <strong>該診次開診後就不再受理該診次的預約</strong>，請直接到院現場掛號候診；
              其他日期與診次仍可照常於網路預約。
            </li>
            <li>同一位病人同一天僅能有 1 筆有效預約（不分醫師、門診類型）。</li>
          </ul>
        </Card>

        <Card className="space-y-2">
          <h2 className="text-lg font-bold text-sage-700">報到只保留 {grace} 分鐘</h2>
          <ul className="list-disc list-inside space-y-1.5 text-ink-900 leading-relaxed">
            <li>
              請於<strong>預約時段開始後 {grace} 分鐘內</strong>完成報到（例：預約 19:00，請於 19:
              {String(grace).padStart(2, "0")} 前到櫃檯），建議提早 5–10 分鐘到院。
            </li>
            <li>
              報到時請<strong>主動告知櫃檯您有預約</strong>並出示健保卡；系統不會自動跳出通知。
            </li>
            <li>逾時該筆預約即取消，需重新抽現場號依序候診。</li>
          </ul>
        </Card>

        <Card className="space-y-2">
          <h2 className="text-lg font-bold text-sage-700">取消與改期</h2>
          <ul className="list-disc list-inside space-y-1.5 text-ink-900 leading-relaxed">
            <li>該診次開診前，都可以在預約系統自行取消或改期。</li>
            <li>該診次開診後，就無法再取消當診的預約，如有需要請致電 {CLINIC.phone}。</li>
            <li>預約時段開始後，一律停止取消，如有需要請致電 {CLINIC.phone}。</li>
            <li>該診次開診後臨時不能來、當天也沒有到診，這筆會列為 1 次未到。</li>
            <li>
              逾時報到、但當天仍有來看診：重新抽現場號後由櫃檯註記，<strong>不列為未到</strong>。
            </li>
            <li>
              <strong>
                累計 {noShowThreshold} 次未到，將暫停網路預約資格 {suspensionText}
              </strong>
              ；期滿累計歸零、自動恢復。期間仍可到院現場掛號。
            </li>
          </ul>
        </Card>

        <Card className="space-y-2">
          <h2 className="text-lg font-bold text-sage-700">一次最多 {activeMax} 筆預約</h2>
          <p className="text-ink-900 leading-relaxed">
            為讓名額公平釋出，每個預約帳號同時最多保留 <strong>{activeMax} 筆</strong>
            尚未完成的預約（<strong>當日的預約不計入</strong>）。已達上限時系統會在送出當下擋下並說明，
            不會自動取消您已經約好的預約；請先取消或完成既有預約後再約。
          </p>
        </Card>

        <Card className="space-y-2">
          <h2 className="text-lg font-bold text-sage-700">同一家庭請由 1 位代表預約</h2>
          <p className="text-ink-900 leading-relaxed">
            同一家庭、同一診次有 2 位以上要看診時，由 1 位成員代表預約 1 個時段即可，
            到診後一起報到、依序看診，不必每人各佔一個名額。（兒童發展篩檢門診除外，見下。）
          </p>
        </Card>

        <Card className="space-y-2">
          <h2 className="text-lg font-bold text-sage-700">要打預防針的話</h2>
          <p className="text-ink-900 leading-relaxed">
            每日最後一診前 1 小時停止施打疫苗（清點申報作業）。不論預約或現場，都請在下列時間前到院：
          </p>
          <ul className="list-disc list-inside space-y-1 text-ink-900 leading-relaxed">
            <li>
              週一至週五：<strong>20:30</strong> 前
            </li>
            <li>
              週六：<strong>17:00</strong> 前
            </li>
            <li>
              週日：<strong>20:00</strong> 前
            </li>
          </ul>
          <p className="text-ink-900 leading-relaxed">
            實際可否接種，仍依醫師當日評估與疫苗現貨為準。
          </p>
        </Card>

        <Card className="space-y-2">
          <h2 className="text-lg font-bold text-sage-700">兒童發展篩檢門診</h2>
          <ul className="list-disc list-inside space-y-1.5 text-ink-900 leading-relaxed">
            <li>
              與一般門診使用同一套預約系統，同樣占用一個時段名額，也計入前面的 {activeMax} 筆額度。
            </li>
            <li>
              <strong>每個時段只安排 1 位兒童施測</strong>；家中有 2 位兒童要施測，請分別預約 2 個時段。
            </li>
            <li>
              施測時間：<strong>週二至週五</strong>上午 09:00–11:30、下午 14:30–16:00；
              <strong>週一僅下午</strong> 14:30–16:00（國定假日不施測）。
            </li>
            <li>
              當天請帶<strong>健保卡</strong>與<strong>兒童健康手冊</strong>，
              <strong>兩樣缺一即無法施測</strong>。
            </li>
            <li>
              早產的孩子請依<strong>矯正年齡</strong>（不是出生後的實際月齡）挑選對應的時段；
              不確定可先來電由櫃檯協助。
            </li>
          </ul>
        </Card>

        <Card className="space-y-2 border-rose-500/40">
          <h2 className="text-lg font-bold text-rose-600">提醒</h2>
          <p className="text-ink-900 leading-relaxed">
            本院為一般門診、非急診。孩子出現呼吸困難、抽搐、意識改變或活力明顯變差，
            請直接告知櫃檯由護理人員先行評估；情況危急請撥打 <strong>119</strong> 或前往鄰近急診。
          </p>
        </Card>

        <Card className="space-y-3">
          <h2 className="text-lg font-bold text-sage-700">個人資料蒐集告知（個資法第 8 條）</h2>
          <div className="text-ink-900 leading-relaxed space-y-2">
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
          <Link href="/" className="text-sage-600 underline underline-offset-2">
            回預約首頁
          </Link>
        </p>
      </div>
    </main>
  );
}
