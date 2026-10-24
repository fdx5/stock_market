import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { authedGet } from "../adminApi";
import { audienceRegionLabel } from "../audiencePlaceNames";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { AudienceCountryFlag, audienceCountryName } from "./AudienceCountrySelect";

type Session = { id: string; source: string; seen_at: number; captured_at: number; country: string; region: string; city: string; browser_days?: number;
  latitude?: number; longitude?: number; accuracy_m?: number };
type Live = { enabled: boolean; updated_at: number; located: number; unlocated: number; sessions: Session[]; total?: number; all_total?: number; truncated?: boolean; unreadable?: number;
  collection_status?: string; geoip_available?: boolean;
  ingestion?: { received: number; eligible: number; privacy_excluded: number; bot_excluded: number };
  diagnostics: { received: number; stored: number; failed: number; received_at?: number | null; stored_at?: number | null } };
const COLLECTION_MESSAGES: Record<string, string> = {
  audience_not_configured: "방문 통계 저장소 또는 가명화 키가 설정되지 않았습니다.",
  audience_store_not_ready: "방문 통계 저장소 초기화가 완료되지 않았습니다.",
  location_key_unavailable: "위치 암호화 키를 사용할 수 없습니다. 서버의 기존 키 설정을 확인해야 합니다.",
  location_store_not_ready: "위치 저장소 초기화가 완료되지 않았습니다.",
};
const clock = (time: number) => new Date(time * 1000).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" });
const accuracy = (meters: number) => meters >= 1000 ? `약 ${(meters / 1000).toFixed(1)}km` : `약 ${Math.ceil(meters)}m`;

export default function AdminAudienceMap({ days = 30, country = "", reloadKey = 0 }: { days?: number; country?: string; reloadKey?: number }) {
  const host = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null), layer = useRef<L.LayerGroup | null>(null);
  const section = useRef<HTMLElement>(null), initialFit = useRef(false);
  const [data, setData] = useState<Live | null>(null), [error, setError] = useState("");
  const [reload, setReload] = useState(0), [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"live" | "regions">("live");
  const [zoom, setZoom] = useState(6);
  useEffect(() => {
    if (!host.current) return;
    const view = L.map(host.current, { minZoom: 2, maxZoom: 19, scrollWheelZoom: true,
      zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView([36.3, 127.8], 6);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(view);
    L.control.scale({ imperial: false }).addTo(view);
    view.on("zoomend", () => setZoom(view.getZoom()));
    layer.current = L.layerGroup().addTo(view); map.current = view;
    const observer = new ResizeObserver(() => view.invalidateSize()); observer.observe(host.current);
    return () => { observer.disconnect(); view.remove(); map.current = null; layer.current = null; };
  }, []);
  useEffect(() => {
    let gone = false, pending = false;
    setData(null); setError(""); setSelected(null); initialFit.current = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try { const result = await authedGet<Live>(mode === "live" ? `/traffic/audience/live?country=${encodeURIComponent(country)}` : `/traffic/audience/regions?days=${days}&country=${encodeURIComponent(country)}`); if (!gone) { setData(result); setError(""); } }
      catch (e) { if (!gone) setError(e instanceof Error ? e.message : "접속 지도를 불러오지 못했습니다."); }
      finally { pending = false; }
    };
    void load(); const stop = startVisibilityAwareInterval(() => void load(), 10_000);
    return () => { gone = true; stop(); };
  }, [reload, mode, days, country, reloadKey]);
  useEffect(() => {
    const group = layer.current, view = map.current;
    if (!group || !view) return;
    group.clearLayers();
    if (!data) return;
    const points: L.LatLngTuple[] = [];
    for (const s of data.sessions) {
      if (s.latitude == null || s.longitude == null) continue;
      const point: L.LatLngTuple = [s.latitude, s.longitude]; points.push(point);
      const precise = s.source === "browser_location", color = precise ? "#27e4b0" : "#49aaff";
      const popup = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = mode === "regions" ? `누적 방문 지역 · ${s.browser_days} 브라우저·일` : `방문 세션 ${s.id.slice(0, 6)}`; popup.append(title);
      for (const text of [audienceRegionLabel(s), precise ? "방문자가 공유한 위치" : "IP 기반 지역 추정 · 도시 중심점",
        `${precise ? "브라우저 보고 오차" : "추정 범위"} ${accuracy(s.accuracy_m || 50000)}`,
        mode === "regions" ? `최근 ${days}일 지역 합계 · 현재 접속 표시 아님` : `위치 확인 ${clock(s.captured_at)} · 최근 접속 ${clock(s.seen_at)}`]) {
        const line = document.createElement("div"); line.textContent = text; popup.append(line);
      }
      L.circle(point, { radius: s.accuracy_m || 50000, color, weight: 1, fillOpacity: .08, interactive: false }).addTo(group);
      const marker = L.circleMarker(point, { radius: selected === s.id ? 11 : 7, color, fillColor: color, fillOpacity: .95, weight: 2 })
        .bindPopup(popup).addTo(group);
      marker.on("click", () => setSelected(s.id));
    }
    if (points.length && !initialFit.current) { view.fitBounds(L.latLngBounds(points), { maxZoom: 9, padding: [40, 40], animate: false }); initialFit.current = true; }
  }, [data, mode]);
  const focus = (s: Session) => {
    setSelected(s.id);
    if (s.latitude != null && s.longitude != null) {
      initialFit.current = true;
      map.current?.stop();
      map.current?.setView([s.latitude, s.longitude], s.source === "browser_location" ? 17 : 11, { animate: false });
    }
  };
  const switchMode = (value: "live" | "regions") => {
    if (value === mode) { setReload(n => n + 1); return; }
    setMode(value); setData(null); initialFit.current = false;
  };
  const fit = () => {
    const points = data?.sessions.filter(s => s.latitude != null && s.longitude != null).map(s => [s.latitude!, s.longitude!] as L.LatLngTuple) || [];
    if (points.length) map.current?.fitBounds(L.latLngBounds(points), { maxZoom: 11, padding: [40, 40] });
    else map.current?.setView([36.3, 127.8], 6);
  };
  const countAvailable = data?.enabled && !(mode === "live" && !data.total && !data.all_total
    && data.diagnostics.failed > 0 && !data.diagnostics.stored);
  return <section ref={section} className="aa-live" aria-label="실시간 접속 위치 지도">
    <div className="aa-header"><div><h3>{mode === "live" ? "최근 24시간 접속 위치 지도" : `최근 ${days}일 방문 지역 지도`}</h3><p>{mode === "live" ? "최근 24시간 공개 페이지 접속 기록" : "선택 기간의 누적 지역 중심점 · 현재 접속 아님"} · 10초마다 갱신 · 지도 확대 {zoom}단계 / 19단계</p></div>
      <div className="aa-controls"><button onClick={() => setReload(n => n + 1)}>지도 새로고침</button><button onClick={fit}>조회 위치 보기</button>
        <button onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void section.current?.requestFullscreen(); }}>지도 크게 보기</button></div></div>
    <div className="aa-controls" style={{marginTop:12}}><button aria-pressed={mode === "live"} onClick={() => switchMode("live")}>최근 24시간 접속</button>
      <button aria-pressed={mode === "regions"} onClick={() => switchMode("regions")}>선택 기간 방문 지역</button></div>
    {error && <p className="aa-notice" role="alert">{error}</p>}
    {data && !data.enabled && <p className="aa-notice" role="alert">접속 수집 상태를 확인해야 합니다. {COLLECTION_MESSAGES[data.collection_status || ""] || "접속 지도용 암호화 저장소를 사용할 수 없습니다."} 아래 수치는 확인 불가이며 실제 접속 0건을 뜻하지 않습니다.</p>}
    <p className="aa-note">조회 국가: {audienceCountryName(country)}</p>
    <div className="aa-live-summary"><span>{mode === "live" ? "24시간 접속 세션" : "누적 방문 지역"} <b>{countAvailable && data ? data.total ?? data.sessions.length : "—"}</b></span><span>위치 확인 <b>{countAvailable ? data?.located : "—"}</b></span>
      <span>위치 미확인 <b>{countAvailable ? data?.unlocated : "—"}</b></span><small>{data ? `조회 시각 ${clock(data.updated_at)}` : "접속 확인 중…"}</small></div>
    {mode === "live" && data?.enabled && <p className="aa-note">현재 서버 시작 이후 · 수집 요청 {data.diagnostics.received.toLocaleString()}회 · 저장 성공 {data.diagnostics.stored.toLocaleString()}회 · 저장 실패 {data.diagnostics.failed.toLocaleString()}회{data.diagnostics.stored_at ? ` · 마지막 저장 ${clock(data.diagnostics.stored_at)}` : ""}. 요청 횟수는 중복 요청을 포함하며 세션 수와 다릅니다.</p>}
    {mode === "live" && data?.ingestion && <p className="aa-note">서버 접속 신호 {data.ingestion.received.toLocaleString()}회 · 수집 대상 {data.ingestion.eligible.toLocaleString()}회 · 개인정보 보호 설정으로 제외 {data.ingestion.privacy_excluded.toLocaleString()}회 · 봇 제외 {data.ingestion.bot_excluded.toLocaleString()}회</p>}
    {mode === "live" && data?.enabled && !data.total && !!data.ingestion?.privacy_excluded && <p className="aa-notice">DNT·GPC 등 개인정보 보호 설정으로 수집하지 않은 접속이 있습니다. 일반 접속 인원과 지도 수집 대상은 다를 수 있습니다.</p>}
    {mode === "live" && data?.enabled && !data.total && !!data.all_total && <p className="aa-notice">전체 국가에는 {data.all_total.toLocaleString()}개 접속 세션이 있습니다. 선택한 국가에 해당하는 접속 기록이 없습니다.</p>}
    {mode === "live" && data?.enabled && !(data.all_total ?? data.total ?? data.sessions.length) && <p className="aa-notice" role="status">{data.diagnostics.failed > 0 && !data.diagnostics.stored
      ? "접속 요청은 수신했지만 지도 저장에 실패했습니다. 접속 0건으로 판단할 수 없습니다."
      : "최근 24시간 지도용 접속 기록이 없습니다. 일반 조회수와 별도 수집하므로 이 값만으로 실제 방문이 없었다고 판단할 수 없습니다."}</p>}
    {mode === "live" && data?.enabled && data.unlocated > 0 && data.geoip_available === false && <p className="aa-notice">IP 위치 자료를 사용할 수 없어 위치를 확인하지 못했습니다. 해당 접속은 위치 미확인 세션에 포함됩니다.</p>}
    <p className="aa-note"><span className="aa-dot aa-dot-ip" /> IP 추정 위치 <span className="aa-dot aa-dot-precise" /> 방문자가 공유한 위치 · 원은 오차 범위입니다.</p>
    <div className="aa-live-layout"><div ref={host} className="aa-map" aria-label="확대와 이동이 가능한 접속 지도" />
      <div className="aa-live-list" aria-label="현재 접속 세션 목록">{data?.sessions.map(s => <button key={s.id} className={selected === s.id ? "selected" : ""} onClick={() => focus(s)}>
        <strong>{mode === "regions" ? `누적 방문 지역 · ${s.browser_days} 브라우저·일` : `방문 세션 ${s.id.slice(0, 6)}`}</strong><span className="aa-country-place"><AudienceCountryFlag country={s.country}/>{audienceRegionLabel(s)}</span><small>{s.latitude == null ? "위치 미확인" : s.source === "browser_location" ? `공유 위치 · 오차 ${accuracy(s.accuracy_m!)}` : "IP 추정 · 도시 중심점"}</small><small>{mode === "regions" ? `최근 ${days}일 지역 합계` : `최근 접속 ${clock(s.seen_at)}`}</small>
      </button>)}{data?.enabled && !data.sessions.length && <p>이 구간의 지도용 위치 기록이 없습니다. 관리자 방문은 제외합니다. 기존 지역 기록은 ‘선택 기간 방문 지역’에서 확인할 수 있습니다.</p>}</div></div>
    <p className="aa-note">최근 24시간 기록이며 현재 온라인 인원과는 다릅니다. IP 위치는 실제 단말 위치가 아니며 확대해도 정확도가 높아지지 않습니다. 정밀 좌표는 방문자가 사이트 하단의 위치 공유 버튼과 브라우저 권한을 허용한 경우에만 확인 시각부터 최대 15분간 표시합니다. 알려진 봇·자동화 브라우저는 제외하고 회원 정보 대신 가명 세션을 표시합니다.</p>
    {!!data?.diagnostics.failed && <p className="aa-notice">최근 서버 시작 이후 위치 저장 실패 {data.diagnostics.failed}회가 있습니다. 저장에 실패한 접속은 이 지도에서 누락될 수 있습니다.</p>}
    {!!data?.unreadable && <p className="aa-notice">일부 위치 정보를 읽지 못해 해당 접속을 위치 미확인으로 표시했습니다. 접속 세션 수에는 포함됩니다.</p>}
    {data?.truncated && <p className="aa-note">전체 {data.total?.toLocaleString()}개 중 최근 500개를 지도와 목록에 표시합니다. 국가를 선택하면 해당 국가에서 최근 500개를 조회합니다.</p>}
  </section>;
}
