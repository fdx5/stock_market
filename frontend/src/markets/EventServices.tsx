import { useState } from "react";
import { Link } from "../router";
import { DataRow, useResearch } from "./researchApi";
import { LocalData, n, Notice, Outcome, ResourceState, safeHref, Stats, Table } from "./ResearchUI";

const PATHS = {
  growth: { label: "성장·소비", match: /GDP|Gross Domestic|Personal Income|Consumption|Consumer/i, steps: ["성장·소비 발표", "실제 수요 변화", "매출 지역·제품 구성", "기업 매출"], check: "매출 지역·제품별 비중, 물량과 판매단가를 확인하세요." },
  prices: { label: "물가·가격", match: /Price|Inflation|PCE|Personal Income/i, steps: ["물가 발표", "가격·정책 기대", "원재료·가격 전가", "기업 마진"], check: "실제 원가 구조와 계약 조건, 가격 전가 여부를 확인하세요." },
  trade: { label: "무역·국제수지", match: /Trade|International|Transactions|Investment/i, steps: ["무역·국제수지", "수출입·환율", "판매 지역·환헤지", "원화 실적"], check: "수출입 통화·해외 매출 비중·환헤지 공시를 확인하세요." },
};
export function EventResearch({ kind }: { kind: string }) {
  const resource = useResearch("/api/discovery/calendar");
  const [category, setCategory] = useState<keyof typeof PATHS>("growth"), [query, setQuery] = useState("");
  const [local, setLocal] = useState<DataRow[] | null>(null), [windowMinutes, setWindowMinutes] = useState(60);
  const path = PATHS[category];
  const all = local ?? resource.data?.items ?? [];
  const items = all.filter(row => (!query || String(row.title).toLowerCase().includes(query.toLowerCase())) && (kind !== "event-impact" || path.match.test(String(row.title)))).sort((a, b) => String(a.at || a.date).localeCompare(String(b.at || b.date)));
  const timed = items.filter(r => r.at && Number.isFinite(Date.parse(r.at)));
  const groups: DataRow[][] = [];
  for (const event of timed) { const last = groups[groups.length - 1]; if (last && Date.parse(event.at) - Date.parse(last[last.length - 1].at) <= Math.max(0, Math.min(1440, windowMinutes)) * 60000) last.push(event); else groups.push([event]); }
  const collisions = groups.filter(group => group.length > 1);
  const viewRows = items.map(row => ({ ...row, time: row.at && Number.isFinite(Date.parse(row.at)) ? new Date(row.at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : `${row.date || "—"} / 시각 미정`, original: row.original_zone || "원문 시간대 확인" }));
  return <><ResourceState resource={resource} /><div className="rs-control-grid"><label className="rs-field">발표 검색<input value={query} onChange={e => setQuery(e.target.value)} placeholder="GDP, 소비, 무역…" /></label>{kind === "event-impact" ? <label className="rs-field">확인할 전달 경로<select value={category} onChange={e => setCategory(e.target.value as keyof typeof PATHS)}>{Object.entries(PATHS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label> : <label className="rs-field">연속 발표 간격(분)<input type="number" min={0} max={1440} value={windowMinutes} onChange={e => setWindowMinutes(Number(e.target.value))} /></label>}</div>
    {kind === "event-impact" ? <Outcome title="발표에서 종목까지, 아직 확인해야 할 연결을 보세요"><div className="rs-path">{path.steps.map((step, i) => <span key={step}>{i > 0 && <b aria-hidden="true">→ </b>}{step}</span>)}</div><p>일정은 관측 사실이고 위 연결은 일반적인 가능 경로입니다. 특정 기업에 이미 영향을 줬다는 확정 진술이 아닙니다. {path.check}</p><Link className="rs-next" to="/theme-evidence">기업 사업·공시 근거로 연결 확인 ↗</Link></Outcome> : <><Outcome title="같은 시간대에 겹치는 발표를 묶었습니다"><p>직전 발표와의 간격이 {windowMinutes}분 이내로 이어지는 묶음을 표시합니다. 시간이 미정인 사건은 충돌로 판정하지 않습니다. 한국시간 표기와 원래 시간대를 함께 확인하세요.</p></Outcome><Stats items={[{ label: "수신 일정", value: items.length }, { label: "시간이 있는 일정", value: timed.length }, { label: "겹치는 묶음", value: collisions.length }]} /><div className="rs-timeline">{collisions.map((group, i) => <article key={i}><small>{new Date(group[0].at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} KST</small><h3>{group.length}개 사건을 함께 확인하세요</h3><ul>{group.map((event, j) => <li key={j}>{event.title}</li>)}</ul></article>)}</div></>}
    <Table caption="한국시간 경제 일정과 원문" rows={viewRows} columns={[{ key: "time", label: "한국시간" }, { key: "title", label: "발표" }, { key: "original", label: "원래 시간대" }, { key: "source", label: "원천" }, { key: "source_url", label: "원문", render: value => <a href={safeHref(value)} target="_blank" rel="noopener noreferrer">발표 일정 ↗</a> }]} /><LocalData columns={["date", "at", "title", "source", "source_url"]} onLoad={setLocal} title="공식 일정 CSV로 비교 범위 넓히기" /><Notice>at 열은 시간대가 포함된 ISO 날짜(예: YYYY-MM-DDTHH:mm:ss+09:00)를 사용하세요. 잘못된 시각은 미정으로 표시하며 영향을 확정하지 않습니다.</Notice></>;
}

export function SessionPlanner() {
  const [start, setStart] = useState(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }));
  const resource = useResearch(`/api/discovery/sessions?start=${start}`);
  return <><label className="rs-field">시작 날짜<input type="date" value={start} onChange={e => { if (e.target.value) setStart(e.target.value); }} /></label><ResourceState resource={resource} /><Outcome title="서울에서 보는 한국·미국 정규장 일정"><p>시간은 IANA 서울·뉴욕 시간대에서 변환합니다. 미국 DST와 표에 등록된 휴장·반장을 반영하며, 휴장표의 지원 연도 밖은 미확인으로 남깁니다.</p></Outcome><Table caption="14일 정규장 시간표" rows={(resource.data?.items ?? []).map(row => ({ ...row, region: row.region === "KR" ? "한국" : "미국", state: !row.calendar_valid ? "휴장표 미확인" : row.open ? row.half_day ? "반장" : "정규장" : "휴장", start_ko: row.start ? new Date(row.start).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : "—", end_ko: row.end ? new Date(row.end).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : "—" }))} columns={[{ key: "date", label: "원시장 날짜" }, { key: "region", label: "시장" }, { key: "state", label: "개장 상태" }, { key: "start_ko", label: "개장 KST" }, { key: "end_ko", label: "마감 KST" }]} /><Link className="rs-next" to="/event-collision">경제발표가 겹치는 시간도 확인 ↗</Link></>;
}
