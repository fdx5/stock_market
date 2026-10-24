import { lazy, Suspense, useEffect, useState } from "react";
import { AdminAuthError, authedGet } from "../adminApi";
import { navigate } from "../router";
import { startVisibilityAwareInterval } from "../pollVisibility";
import "./adminAudience.css";
import { audienceRegionLabel } from "../audiencePlaceNames";
import AudienceCountrySelect, { AudienceCountryFlag, audienceCountryName } from "./AudienceCountrySelect";
const AdminAudienceMap = lazy(() => import("./AdminAudienceMap"));

type Audience = {
  enabled: boolean; edge_configured: boolean; days: number; start_date: string; end_date: string;
  available_from: string | null; browsers: number; sessions: number; repeat_browsers: number;
  regular_browsers: number; network_days: number; located_browser_days: number; browser_days: number;
  country: string; countries: Array<{ country: string; browser_days: number }>;
  regions: Array<{ country: string; region: string; city: string; source: string; browser_days: number }>;
};
const nf = new Intl.NumberFormat("ko-KR");

export default function AdminAudiencePanel() {
  const [days, setDays] = useState(30);
  const [country, setCountry] = useState("");
  const [result, setResult] = useState<Audience | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false, pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const data = await authedGet<Audience>(`/traffic/audience?days=${days}&country=${encodeURIComponent(country)}`);
        if (!cancelled) { setResult(data); setError(""); }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AdminAuthError) { navigate("/admin"); return; }
        setError(err instanceof Error ? err.message : "통계를 불러오지 못했습니다.");
      } finally { pending = false; }
    };
    void load();
    const stop = startVisibilityAwareInterval(() => void load(), 30_000);
    return () => { cancelled = true; stop(); };
  }, [days, country, reload]);
  const data = result?.days === days && (result.country || "") === country ? result : null;
  const coverage = data?.browser_days ? data.located_browser_days / data.browser_days * 100 : 0;
  return <section className="admin-panel aa-panel" aria-label="재방문 및 지역 통계">
    <header className="aa-header"><div><small>AUDIENCE & LOCATION</small><h2>재방문 · 접속 지역</h2>
      <p>{data ? `${data.start_date} ~ ${data.end_date} · 한국시간` : "선택 기간의 브라우저 방문 통계"}</p></div>
      <div className="aa-controls"><label>조회 기간 <select value={days} onChange={e => setDays(Number(e.target.value))}>
        {[7, 30, 90].map(n => <option key={n} value={n}>최근 {n}일</option>)}
      </select></label><AudienceCountrySelect value={country} countries={(result?.countries || []).map(r => r.country || "unknown")} onChange={setCountry}/>
      <button type="button" onClick={() => setReload(n => n + 1)}>새로고침</button></div>
    </header>
    {error && <p role="alert" className="aa-notice">{error} <button type="button" onClick={() => setReload(n => n + 1)}>다시 시도</button></p>}
    {!data && !error && <p role="status">방문 통계를 불러오는 중…</p>}
    {data && !data.enabled && <p className="aa-notice" role="status">수집 준비 중입니다. 서버의 전용 통계 저장소와 가명화 키를 설정한 뒤부터 통계가 쌓입니다.</p>}
    <Suspense fallback={<p>접속 지도 불러오는 중…</p>}><AdminAudienceMap days={days} country={country} reloadKey={reload}/></Suspense>
    {data?.enabled && <>
      <div className="aa-metrics">{[
        ["방문 브라우저", data.browsers, "선택 기간 중복 제외"],
        ["재방문 브라우저", data.repeat_browsers, "서로 다른 2일 이상 방문"],
        ["꾸준한 방문", data.regular_browsers, "서로 다른 3일 이상 방문"],
        ["일별 접속망 합계", data.network_days, "하루 안에서 IP 중복 제외"],
      ].map(([label, value, hint]) => <div key={String(label)}><span>{label}</span><strong>{nf.format(Number(value))}</strong><small>{hint}</small></div>)}</div>
      <p className="aa-note">실제 사람 수와 다를 수 있습니다. 브라우저·기기 변경 및 저장소 초기화는 새 방문으로, 공용 IP는 같은 접속망으로 잡힙니다. 수집 시작 {data.available_from || "기록 없음"} · 지역 확인률 {coverage.toFixed(1)}%</p>
      {!data.edge_configured && <p className="aa-notice">접속망·지역 확인을 위한 신뢰 프록시 연결이 설정되지 않았습니다. 브라우저 집계만 진행하며 IP·지역은 미확인으로 처리합니다.</p>}
      <p className="aa-note">조회 국가: {audienceCountryName(country)} · 국가 선택은 지도와 아래 지역 목록에 적용됩니다. 위 방문 지표는 전체 국가 기준입니다.</p>
      <div className="aa-table-wrap"><table className="aa-table"><caption>추정 접속 지역 · {audienceCountryName(country)} · 일별 브라우저 수 합계 상위 100개</caption>
        <thead><tr><th scope="col">지역</th><th scope="col">확인 방식</th><th scope="col">방문일 합계</th></tr></thead>
        <tbody>{data.regions.map((r, i) => <tr key={i}><td><span className="aa-country-place"><AudienceCountryFlag country={r.country}/>{audienceRegionLabel(r)}</span></td><td>{r.source === "browser_location" ? "허용한 브라우저 위치" : ["cloudflare_ip", "dbip_city_lite"].includes(r.source) ? "IP 기반 추정" : "미확인"}</td><td>{nf.format(r.browser_days)}</td></tr>)}</tbody>
      </table>{!data.regions.length && <p>선택한 기간과 국가에 해당하는 방문 기록이 없습니다.</p>}</div>
      <p className="aa-note">IP 지역은 실제 위치와 다를 수 있으며 통신사망·VPN의 영향을 받습니다. 같은 브라우저가 하루에 여러 지역을 이용하면 각 지역에 집계됩니다. 원문 IP는 새 통계에 저장하지 않습니다.</p>
      <p className="aa-note">IP 지역 자료: <a href="https://db-ip.com" target="_blank" rel="noreferrer">IP Geolocation by DB-IP</a> · City Lite, CC BY 4.0</p>
      <p className="aa-note">한글 지명 자료: <a href="https://www.geonames.org" target="_blank" rel="noreferrer">GeoNames</a> · CC BY 4.0 · 한글 이름이 확인되지 않은 지명은 원문을 표시합니다.</p>
    </>}
  </section>;
}
