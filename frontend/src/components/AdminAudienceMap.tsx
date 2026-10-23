import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { authedGet } from "../adminApi";
import { audienceRegionLabel } from "../audiencePlaceNames";
import { startVisibilityAwareInterval } from "../pollVisibility";

type Session = { id: string; source: string; seen_at: number; captured_at: number; country: string; region: string; city: string; browser_days?: number;
  latitude?: number; longitude?: number; accuracy_m?: number };
type Live = { enabled: boolean; updated_at: number; located: number; unlocated: number; sessions: Session[];
  diagnostics: { received: number; stored: number; failed: number } };
const clock = (time: number) => new Date(time * 1000).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" });
const accuracy = (meters: number) => meters >= 1000 ? `약 ${(meters / 1000).toFixed(1)}km` : `약 ${Math.ceil(meters)}m`;

export default function AdminAudienceMap({ days = 30 }: { days?: number }) {
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
    const load = async () => {
      if (pending) return;
      pending = true;
      try { const result = await authedGet<Live>(mode === "live" ? "/traffic/audience/live" : `/traffic/audience/regions?days=${days}`); if (!gone) { setData(result); setError(""); } }
      catch (e) { if (!gone) setError(e instanceof Error ? e.message : "접속 지도를 불러오지 못했습니다."); }
      finally { pending = false; }
    };
    void load(); const stop = startVisibilityAwareInterval(() => void load(), 10_000);
    return () => { gone = true; stop(); };
  }, [reload, mode, days]);
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
  return <section ref={section} className="aa-live" aria-label="실시간 접속 위치 지도">
    <div className="aa-header"><div><h3>{mode === "live" ? "최근 24시간 접속 위치 지도" : `최근 ${days}일 방문 지역 지도`}</h3><p>{mode === "live" ? "최근 24시간 공개 페이지 접속 기록" : "선택 기간의 누적 지역 중심점 · 현재 접속 아님"} · 10초마다 갱신 · 지도 확대 {zoom}단계 / 19단계</p></div>
      <div className="aa-controls"><button onClick={() => setReload(n => n + 1)}>지도 새로고침</button><button onClick={fit}>전체 위치 보기</button>
        <button onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void section.current?.requestFullscreen(); }}>지도 크게 보기</button></div></div>
    <div className="aa-controls" style={{marginTop:12}}><button aria-pressed={mode === "live"} onClick={() => switchMode("live")}>최근 24시간 접속</button>
      <button aria-pressed={mode === "regions"} onClick={() => switchMode("regions")}>선택 기간 방문 지역</button></div>
    {error && <p className="aa-notice" role="alert">{error}</p>}
    {data && !data.enabled && <p className="aa-notice">접속 지도용 암호화 저장소를 준비 중입니다.</p>}
    <div className="aa-live-summary"><span>{mode === "live" ? "24시간 접속 세션" : "누적 방문 지역"} <b>{data?.sessions.length ?? "—"}</b></span><span>지도 표시 <b>{data?.located ?? "—"}</b></span>
      <span>위치 미확인 <b>{data?.unlocated ?? "—"}</b></span><small>{data ? `최근 확인 ${clock(data.updated_at)}` : "접속 확인 중…"}</small></div>
    <p className="aa-note"><span className="aa-dot aa-dot-ip" /> IP 추정 위치 <span className="aa-dot aa-dot-precise" /> 방문자가 공유한 위치 · 원은 오차 범위입니다.</p>
    <div className="aa-live-layout"><div ref={host} className="aa-map" aria-label="확대와 이동이 가능한 접속 지도" />
      <div className="aa-live-list" aria-label="현재 접속 세션 목록">{data?.sessions.map(s => <button key={s.id} className={selected === s.id ? "selected" : ""} onClick={() => focus(s)}>
        <strong>{mode === "regions" ? `누적 방문 지역 · ${s.browser_days} 브라우저·일` : `방문 세션 ${s.id.slice(0, 6)}`}</strong><span>{audienceRegionLabel(s)}</span><small>{s.latitude == null ? "위치 미확인" : s.source === "browser_location" ? `공유 위치 · 오차 ${accuracy(s.accuracy_m!)}` : "IP 추정 · 도시 중심점"}</small><small>{mode === "regions" ? `최근 ${days}일 지역 합계` : `최근 접속 ${clock(s.seen_at)}`}</small>
      </button>)}{data && !data.sessions.length && <p>이 구간의 지도용 위치 기록이 없습니다. 관리자 방문은 제외합니다. 기존 지역 기록은 ‘선택 기간 방문 지역’에서 확인할 수 있습니다.</p>}</div></div>
    <p className="aa-note">최근 24시간 기록이며 현재 온라인 인원과는 다릅니다. IP 위치는 실제 단말 위치가 아니며 확대해도 정확도가 높아지지 않습니다. 정밀 좌표는 방문자가 사이트 하단의 위치 공유 버튼과 브라우저 권한을 허용한 경우에만 확인 시각부터 최대 15분간 표시합니다. 알려진 봇·자동화 브라우저는 제외하고 회원 정보 대신 가명 세션을 표시합니다.</p>
    {!!data?.diagnostics.failed && <p className="aa-notice">최근 서버 시작 이후 위치 저장 실패 {data.diagnostics.failed}회가 있습니다. 마지막 정상 기록을 표시합니다.</p>}
  </section>;
}
