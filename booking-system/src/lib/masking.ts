/** 敏感資料遮罩（前台與一般後台列表一律顯示遮罩版本） */

/** A123456789 → A12****789；過短則全遮 */
export function maskIdNumber(idNumber: string): string {
  const s = idNumber.trim().toUpperCase();
  if (s.length < 8) return "*".repeat(s.length);
  return `${s.slice(0, 3)}${"*".repeat(s.length - 6)}${s.slice(-3)}`;
}

/** 0912345678 → 0912***678 */
export function maskPhone(phone: string): string {
  const s = phone.trim();
  if (s.length < 7) return "*".repeat(s.length);
  return `${s.slice(0, 4)}${"*".repeat(s.length - 7)}${s.slice(-3)}`;
}

/** 王小明 → 王○明；二字名 → 王○ */
export function maskName(name: string): string {
  const s = name.trim();
  if (s.length <= 1) return s;
  if (s.length === 2) return `${s[0]}○`;
  return `${s[0]}${"○".repeat(s.length - 2)}${s[s.length - 1]}`;
}
