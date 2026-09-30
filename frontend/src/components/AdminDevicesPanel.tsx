import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { adminApi, AdminAuthError, clearStoredSession } from "../adminApi";
import type { DeviceTraffic, DeviceType } from "../adminApi";
import { navigate } from "../router";
import { startVisibilityAwareInterval } from "../pollVisibility";
import "./adminDevices.css";

const TYPES: Array<{ type: DeviceType; label: string; color: string; icon: string }> = [
  { type: "desktop", label: "데스크톱", color: "var(--series-blue, #5889ef)", icon: "▣" },
  { type: "tablet", label: "태블릿", color: "var(--series-violet, #a481f0)", icon: "▤" },
  { type: "mobile", label: "모바일", color: "var(--series-aqua, #31c6b8)", icon: "▯" },
  { type: "unknown", label: "미확인", color: "var(--text-muted, #8893a5)", icon: "?" },
];
const nf = new Intl.NumberFormat("ko-KR");
const percent = (n: number) => `${n.toFixed(1)}%`;

function SmallDistribution({ title, rows }: { title: string; rows: DeviceTraffic["browsers"] }) {
  const display = rows.slice(0, 5);
  if (rows.length > 5) display.push({ name: "기타", count: rows.slice(5).reduce((n, row) => n + row.count, 0), percentage: rows.slice(5).reduce((n, row) => n + row.percentage, 0) });
  return <section className="ad-device-extra"><h3>{title}<small>전체 조회 기준</small></h3>
    {display.map(row => <div className="ad-device-small-row" key={row.name}>
      <span>{row.name}</span><div className="ad-device-small-bar"><i style={{ width: `${row.percentage}%` }} /></div>
      <b>{percent(row.percentage)}</b>
    </div>)}
    {!rows.length && <p className="ad-device-empty">수집된 데이터가 없습니다.</p>}
  </section>;
}

export function DeviceTrafficView({ data }: { data: DeviceTraffic }) {
  const [selected, setSelected] = useState<DeviceType | null>(null);
  const circumference = 2 * Math.PI * 66;
  let offset = 0;
  const slices = TYPES.map(item => {
    const count = data.types.find(row => row.type === item.type)?.count || 0;
    const length = data.total ? count / data.total * circumference : 0;
    const slice = { ...item, count, length, offset };
    offset += length;
    return slice;
  });
  return <>
    {!data.history_ready && <p className="ad-device-notice" role="status">과거 로그 집계 중 · {nf.format(data.missing_days)}일 미완료. 아래 비중은 현재 집계된 데이터 기준이며 완료 후 자동 갱신됩니다.</p>}
    <div className="ad-device-summary">
      <div className="ad-device-donut">
        <svg viewBox="0 0 180 180" role="img" aria-label={data.total ? slices.map(s => `${s.label} ${percent(s.count / data.total * 100)}`).join(", ") : "기기별 조회 데이터 없음"}>
          <circle cx="90" cy="90" r="66" fill="none" stroke="var(--border)" strokeWidth="23" />
          <g transform="rotate(-90 90 90)">{slices.filter(s => s.count > 0).map(s => <circle key={s.type} cx="90" cy="90" r="66" fill="none" stroke={s.color} strokeWidth="23"
            strokeDasharray={`${s.length} ${circumference - s.length}`} strokeDashoffset={-s.offset}
            opacity={selected && selected !== s.type ? .35 : 1}><title>{`${s.label}: ${nf.format(s.count)}회`}</title></circle>)}</g>
        </svg>
        <div className="ad-device-donut-center"><small>봇 제외 조회수</small><strong>{nf.format(data.total)}</strong><span>{data.total ? "회" : "데이터 없음"}</span></div>
      </div>
      <div className="ad-device-legend">
        <h3>어떤 디바이스로 접속했나요?</h3>
        {slices.filter(s => s.type !== "unknown" || s.count > 0).map(s => <button type="button" key={s.type} aria-pressed={selected === s.type}
          onClick={() => setSelected(selected === s.type ? null : s.type)} style={{ "--device-color": s.color } as CSSProperties}>
          <i aria-hidden="true" /><span>{s.label}</span><small>{nf.format(s.count)}회</small><b>{percent(data.total ? s.count / data.total * 100 : 0)}</b>
        </button>)}
        <p>유형 확인률 <b>{percent(data.coverage_percentage)}</b> · 미확인 로그도 전체 분모에 포함</p>
      </div>
    </div>
    <div className="ad-device-cards">
      {slices.filter(s => s.type !== "unknown" || s.count > 0).map(s => {
        const rows = data.devices.filter(row => row.type === s.type);
        const rest = rows.slice(5);
        const renderRow = (row: typeof rows[number]) => <li key={row.name}>
          <div><span title={row.name}>{row.name}</span><b>{percent(row.within_type_percentage)}</b></div>
          <div className="ad-device-model-bar"><i style={{ width: `${row.within_type_percentage}%` }} /></div>
          <small>{nf.format(row.count)}회</small>
        </li>;
        return <section key={s.type} className={`ad-device-card${selected === s.type ? " is-selected" : ""}`} style={{ "--device-color": s.color } as CSSProperties}>
          <header><span aria-hidden="true">{s.icon}</span><h3>{s.label}<small>{nf.format(s.count)}회 · 유형 내 비중</small></h3></header>
          <ol>{rows.slice(0, 5).map(renderRow)}</ol>
          {rest.length > 0 && <details><summary>외 {rest.length}종 · {nf.format(rest.reduce((n, row) => n + row.count, 0))}회 보기</summary><ol>{rest.map(renderRow)}</ol></details>}
          {!rows.length && <p className="ad-device-empty">수집된 조회가 없습니다.</p>}
        </section>;
      })}
    </div>
    <div className="ad-device-extras"><SmallDistribution title="운영체제" rows={data.operating_systems} /><SmallDistribution title="브라우저" rows={data.browsers} /></div>
    <footer className="ad-device-foot">
      <p>페이지뷰 기준(순 방문자·실제 기기 대수 아님) · 봇/클릭 이벤트 제외 · 한국시간 일별 집계</p>
      <p>기종은 브라우저가 공개한 정보만 표시합니다. iPhone 세부 모델·PC 제조사는 식별하지 않으며, 과거 태블릿의 데스크톱 모드는 정확히 구분되지 않을 수 있습니다.</p>
      <small>수집 이력 {data.available_from || "확인 중"}부터 · 조회 갱신 {new Date(data.generated_at).toLocaleTimeString("ko-KR", { hour12: false })}</small>
    </footer>
  </>;
}

export default function AdminDevicesPanel() {
  const [days, setDays] = useState(30);
  const [result, setResult] = useState<{ days: number; data: DeviceTraffic } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false, loading = false;
    setError(null);
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const data = await adminApi.deviceTraffic(days);
        if (!cancelled) { setResult({ days, data }); setError(null); }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AdminAuthError) { clearStoredSession(); navigate("/admin"); return; }
        setError(err instanceof Error ? err.message : "기기 통계를 불러오지 못했습니다.");
      } finally { loading = false; }
    };
    void load();
    const stop = startVisibilityAwareInterval(() => void load(), 60_000);
    return () => { cancelled = true; stop(); };
  }, [days, reload]);
  const data = result?.days === days ? result.data : null;
  return <section className="admin-panel ad-devices" aria-label="접속 디바이스 통계">
    <header className="ad-device-head"><div><small>DEVICE ANALYTICS</small><h2>접속 디바이스 분석</h2><p>{data ? `${data.start_date} ~ ${data.end_date}` : "선택 기간의 로그를 분석합니다."}</p></div>
      <div className="ad-device-controls"><label>조회 기간 <select value={days} onChange={event => setDays(Number(event.target.value))}>
        {[1, 7, 30, 90, 365, 730].map(d => <option key={d} value={d}>{d === 1 ? "오늘" : `최근 ${d}일`}</option>)}
      </select></label><button type="button" onClick={() => setReload(n => n + 1)} aria-label="기기 통계 새로고침">↻</button></div>
    </header>
    {error && <div className="ad-device-notice is-error" role="alert">{error}{data && " · 마지막 성공 값 표시 중"}<button type="button" onClick={() => setReload(n => n + 1)}>다시 시도</button></div>}
    {data ? <DeviceTrafficView data={data} /> : !error && <p className="ad-device-loading" role="status">기기별 집계 데이터를 불러오는 중…</p>}
  </section>;
}
