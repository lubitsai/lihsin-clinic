/**
 * 簡訊供應商可替換模組。
 * 以 SMS_PROVIDER 環境變數切換：console（開發）/ mitake（三竹）/ every8d。
 * 新增供應商：實作 SmsProvider 介面並在 getSmsProvider 註冊即可，
 * 其他程式碼一律透過 getSmsProvider().send() 呼叫，不直接依賴特定廠商。
 */

export interface SmsProvider {
  readonly name: string;
  send(phone: string, message: string): Promise<void>;
}

/** 開發用：不實際發送，印到 stdout（手機號遮罩） */
class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";
  async send(phone: string, message: string): Promise<void> {
    const masked = phone.length >= 7 ? `${phone.slice(0, 4)}***${phone.slice(-3)}` : "***";
    console.log(`[SMS→${masked}] ${message.replaceAll("\n", " / ")}`);
  }
}

/** 三竹資訊 SmSend HTTP API（正式帳號由診所申請，帳密放環境變數） */
class MitakeSmsProvider implements SmsProvider {
  readonly name = "mitake";
  async send(phone: string, message: string): Promise<void> {
    const username = process.env.SMS_API_USERNAME;
    const password = process.env.SMS_API_PASSWORD;
    if (!username || !password) throw new Error("SMS_API_USERNAME/PASSWORD 未設定");
    const body = new URLSearchParams({
      username,
      password,
      dstaddr: phone,
      smbody: message,
      CharsetURL: "UTF8",
    });
    const res = await fetch("https://smsapi.mitake.com.tw/api/mtk/SmSend", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await res.text();
    if (!res.ok || /statuscode=[^01234]/.test(text)) {
      throw new Error(`三竹簡訊發送失敗：HTTP ${res.status}`);
    }
  }
}

/** 互動資通 every8d API */
class Every8dSmsProvider implements SmsProvider {
  readonly name = "every8d";
  async send(phone: string, message: string): Promise<void> {
    const username = process.env.SMS_API_USERNAME;
    const password = process.env.SMS_API_PASSWORD;
    if (!username || !password) throw new Error("SMS_API_USERNAME/PASSWORD 未設定");
    const body = new URLSearchParams({ UID: username, PWD: password, DEST: phone, MSG: message });
    const res = await fetch("https://api.e8d.tw/API21/HTTP/sendSMS.ashx", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await res.text();
    if (!res.ok || text.startsWith("-")) {
      throw new Error(`every8d 簡訊發送失敗：HTTP ${res.status}`);
    }
  }
}

let provider: SmsProvider | null = null;

export function getSmsProvider(): SmsProvider {
  if (provider) return provider;
  switch (process.env.SMS_PROVIDER ?? "console") {
    case "mitake":
      provider = new MitakeSmsProvider();
      break;
    case "every8d":
      provider = new Every8dSmsProvider();
      break;
    default:
      provider = new ConsoleSmsProvider();
  }
  return provider;
}

/** 測試用：重設供應商快取 */
export function resetSmsProvider() {
  provider = null;
}
