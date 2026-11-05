/** Toss timestamps carry an offset; Naver's bare timestamps are already Korean time. */
const koreanTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year:"numeric", month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23" });

export function formatDiscussionTime(raw: string, includeYear = false): string {
  if (!raw) return "";
  const value = raw.trim();
  if (/^(방금|\d+\s*(분|시간|일)\s*전)$/.test(value)) return value;
  const match = value.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!match) return "—";
  const [, year, month, day, hour, minute, second, fraction, offset] = match;
  const dateOnly = !hour;
  const stamp = `${year}-${month.padStart(2,"0")}-${day.padStart(2,"0")}T${(hour || "00").padStart(2,"0")}:${minute || "00"}:${second || "00"}.${(fraction || "0").slice(0,3).padEnd(3,"0")}${offset || "+09:00"}`;
  const date = new Date(stamp);
  if (!Number.isFinite(date.getTime())) return "—";
  const parts = koreanTime.formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)?.value || "";
  return `${includeYear ? `${part("year")}.` : ""}${part("month")}.${part("day")}${dateOnly ? "" : ` ${part("hour")}:${part("minute")}`}`;
}
