import { reportResearchEvent } from "../useActivityTracking";
import { ReactNode, useRef, useState } from "react";
import { Link } from "../router";
import { DataRow, ResearchData, useResearch } from "./researchApi";
import { n, p, delta, parseCsv, localNumber, safeHref } from "./researchFormat";
export { n, p, delta, parseCsv, localNumber, safeHref } from "./researchFormat";

export type Research = ReturnType<typeof useResearch>;
export function ResourceState({ resource }: { resource: Research }) {
  return <div className="rs-source" aria-live="polite">{resource.loading && <span role="status">공개 자료를 확인하고 있습니다…</span>}{resource.error && <div role="status"><b>{resource.data ? "갱신 실패 · 이전 자료 유지" : "자료 수신 실패"}</b><p>{resource.error}</p><button type="button" onClick={resource.reload}>자료 다시 불러오기</button></div>}{resource.data && <><b>{resource.data.source}</b><span>{resource.data.coverage}</span>{resource.data.received_at && <small>수신 {new Date(resource.data.received_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} KST</small>}{resource.data.source_url && <a href={resource.data.source_url} target="_blank" rel="noopener noreferrer">원문 확인 ↗</a>}</>}</div>;
}
export function Stats({ items }: { items: { label: string; value: ReactNode; note?: string }[] }) { return <div className="rs-stats">{items.map((item, i) => <article key={item.label + i}><small>{item.label}</small><strong>{item.value}</strong>{item.note && <p>{item.note}</p>}</article>)}</div>; }
export function Table({ caption, columns, rows }: { caption: string; columns: { key: string; label: string; render?: (value: any, row: DataRow) => ReactNode }[]; rows: DataRow[] }) {
  const [limit, setLimit] = useState(15);
  return <div className="rs-table-wrap" tabIndex={0} role="region" aria-label={caption}><table className="rs-table"><caption>{caption} · {rows.length}개</caption><thead><tr>{columns.map(c => <th key={c.key} scope="col">{c.label}</th>)}</tr></thead><tbody>{rows.slice(0, limit).map((row, i) => <tr key={row.id ?? `${row.code ?? row.date ?? "row"}-${i}`}>{columns.map((c, j) => j === 0 ? <th scope="row" key={c.key}>{c.render ? c.render(row[c.key], row) : String(row[c.key] ?? "—")}</th> : <td key={c.key}>{c.render ? c.render(row[c.key], row) : row[c.key] === null || row[c.key] === undefined ? "—" : String(row[c.key])}</td>)}</tr>)}</tbody></table>{rows.length > limit && <button type="button" className="rs-table-more" onClick={() => setLimit(n => n + 30)}>30? ? ?? ({Math.min(limit, rows.length)}/{rows.length})</button>}{!rows.length && <p className="rs-empty">수신된 항목이 없습니다. 조회 조건을 바꾸거나 제공된 로컬 자료 가져오기를 이용하세요.</p>}</div>;
}
export function Bars({ items, suffix = "%" }: { items: { label: string; value: number | null }[]; suffix?: string }) {
  const max = Math.max(1, ...items.map(i => Math.abs(i.value ?? 0)));
  return <div className="rs-bars">{items.map((item, i) => <div key={item.label + i}><span>{item.label}</span><div><i style={{ width: `${Math.abs(item.value ?? 0) / max * 100}%`, background: (item.value ?? 0) < 0 ? "var(--down)" : "var(--brass)" }} /></div><b>{item.value === null ? "—" : n(item.value) + suffix}</b></div>)}</div>;
}
export function Notice({ children }: { children: ReactNode }) { return <p className="rs-notice">{children}</p>; }
export function Outcome({ title, children }: { title: string; children: ReactNode }) { return <section className="rs-outcome"><span>WHAT THE DATA SAYS</span><h2>{title}</h2><div>{children}</div></section>; }

export function LocalData({ columns, onLoad, title = "내 컴퓨터의 자료로 계산" }: { columns: string[]; onLoad: (rows: DataRow[]) => void; title?: string }) {
  const input = useRef<HTMLInputElement>(null); const [message, setMessage] = useState("");
  const load = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 400_000) throw new Error("400KB 이하 자료를 선택하세요.");
      const text = await file.text(), rows: DataRow[] = file.name.toLowerCase().endsWith(".json") ? JSON.parse(text) : parseCsv(text);
      if (!Array.isArray(rows) || !rows.length || rows.length > 1000 || rows.some(r => !r || typeof r !== "object" || !columns.every(c => Object.prototype.hasOwnProperty.call(r, c) && (r[c] === null || typeof r[c] === "string" || typeof r[c] === "number")))) throw new Error(`필수 열: ${columns.join(", ")}`);
      onLoad(rows); reportResearchEvent("import_local"); setMessage(`${rows.length}개 행을 이 화면에서만 읽었습니다.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "자료 형식을 확인하세요."); }
  };
  const template = () => {
    const url = URL.createObjectURL(new Blob(["\uFEFF" + columns.join(",") + "\r\n"], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "research-columns.csv"; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <details className="rs-local" data-track="self"><summary>{title}</summary><p>파일은 서버로 전송하거나 저장하지 않습니다. CSV 또는 JSON, 최대 1,000행·400KB. 필요한 열: <code>{columns.join(", ")}</code></p><div><button type="button" onClick={() => input.current?.click()}>자료 선택</button><button type="button" onClick={template}>빈 CSV 양식</button><input ref={input} aria-label={title} type="file" accept=".csv,.json" onChange={e => void load(e.target.files?.[0])} /></div><span role="status">{message}</span></details>;
}

export function publicCode(code: string) { return /^[A-Za-z0-9.\-]{1,16}$/.test(code) ? code.toUpperCase() : "005930"; }
export const stockUrl = (code: string) => `/stock/${encodeURIComponent(code)}`;
export function StockAnchor({ code, name }: { code: string; name?: string }) { return <Link to={stockUrl(code)}>{name || code} ↗</Link>; }
