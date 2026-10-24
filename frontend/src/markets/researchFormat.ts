import { finite } from "./discoveryModel";
import type { DataRow } from "./researchApi";

export const n = (v: unknown, digits: unknown = 2) => finite(v) === null ? "—" : Number(v).toLocaleString("ko-KR", { maximumFractionDigits: typeof digits === "number" ? Math.max(0, Math.min(10, digits)) : 2 });
export const p = (v: unknown) => finite(v) === null ? "—" : `${Number(v) > 0 ? "+" : ""}${n(v)}%`;
export const delta = (last: unknown, first: unknown) => typeof last === "number" && typeof first === "number" && Number.isFinite(last) && Number.isFinite(first) && first > 0 ? (last / first - 1) * 100 : null;

export function parseCsv(text: string): DataRow[] {
  const all: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (ch === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell.trim()); if (row.some(Boolean)) all.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (quoted) throw new Error("따옴표가 닫히지 않은 CSV입니다.");
  row.push(cell.trim()); if (row.some(Boolean)) all.push(row);
  const header = all.shift()?.map(h => h.replace(/^\uFEFF/, "")) ?? [];
  if (!header.length || new Set(header).size !== header.length || header.some(k => ["__proto__", "prototype", "constructor"].includes(k))) throw new Error("열 이름을 확인하세요.");
  return all.slice(0, 1000).map(values => Object.fromEntries(header.map((key, i) => [key, values[i] ?? ""])));
}


export function localNumber(value: any) { const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, "")); return value === null || value === undefined || String(value).trim() === "" || !Number.isFinite(parsed) ? null : parsed; }
export const safeHref = (value: unknown) => typeof value === "string" && /^https?:\/\//i.test(value) ? value : undefined;
export function dividendAmount(value: unknown, currency: unknown): string {
  const amount = localNumber(value);
  if (amount === null) return "—";
  const unit = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  const number = amount.toLocaleString("ko-KR", { maximumFractionDigits: 6 });
  if (unit === "KRW") return `${number}원 (KRW)`;
  if (unit === "USD") return `${number}달러 (USD)`;
  return `${number} (${unit && /^[A-Z]{3}$/.test(unit) ? unit : "통화 미확인"})`;
}
