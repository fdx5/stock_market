import { useEffect, useRef, useState } from 'react';
import type { DroneLive } from './droneLive';
import type { DroneWhere } from './DroneRadar';
import { FACILITY, LIVE_STATUS_TEXT, liveApi, liveState, subwayData, type LiveKind, type LiveRef, type LiveStatus } from './publicLive';

/** Opens a live panel (the overlay listens): from the list, a row's own panel. */
export const openLive = (item: LiveRef) => window.dispatchEvent(new CustomEvent('live-open', { detail: item }));

/* The drone's live public layers, switched on and off over the radar: subway stations and the
 * trains running now, emergency rooms' free beds, road speeds on the roads themselves, 따릉이
 * docks and public car parks. Each is fetched round the drone only while it is on, again as the
 * drone moves on and as the data ages (the server caches each provider: never more often). */

const LAYERS: { kind: LiveKind; icon: string; label: string }[] = [
  { kind: 'subway', icon: '🚇', label: '지하철' },
  { kind: 'er', icon: '🚑', label: '응급실' },
  // (도로소통: hidden — TOPIS answers for only a few of the standard links the roads carry, and
  // the national ITS feed does not answer the hosting network; the layer stays, switched off)
  { kind: 'bike', icon: '🚲', label: '따릉이' },
  { kind: 'parking', icon: '🅿️', label: '주차장' },
  { kind: 'facility', icon: '🚒', label: '공공시설' },
];
type Info = { status: LiveStatus | 'loading'; text: string };

export default function LiveLayerControls({ live, where }: { live: DroneLive; where: () => DroneWhere | null }) {
  const [on, setOn] = useState<Record<LiveKind, boolean>>({ ...live.on });
  const [info, setInfo] = useState<Partial<Record<LiveKind, Info>>>({});
  // (folded on a small screen: the radar column is short there)
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerHeight > 700);
  const whereRef = useRef(where); whereRef.current = where;
  const note = (k: LiveKind, v: Info | null) => setInfo(o => { const n = { ...o }; if (v) n[k] = v; else delete n[k]; return n; });
  const toggle = (k: LiveKind) => setOn(o => { const n = { ...o, [k]: !o[k] }; live.on[k] = n[k]; return n; });
  useEffect(() => () => live.dispose(), [live]);

  // One loop per layer while it is on: `due` says whether to ask again (moved far, or the data aged).
  const loop = (k: LiveKind, every: number, moved: number, run: (p: DroneWhere, signal: AbortSignal) => Promise<Info | null>, off: () => void) => {
    useEffect(() => {
      if (!on[k]) { off(); note(k, null); return; }
      const stop = new AbortController(); let last: DroneWhere | null = null, at = 0, busy = false;
      note(k, { status: 'loading', text: '불러오는 중…' });
      const tick = async () => {
        const p = whereRef.current(); if (!p || busy || document.hidden) return;
        const d = last ? Math.hypot((p.lat - last.lat) * 110540, (p.lon - last.lon) * 111320 * Math.cos(p.lat * Math.PI / 180)) : Infinity;
        if (last && Date.now() - at < every && d < moved) return;
        busy = true; last = p; at = Date.now();
        try { const v = await run(p, stop.signal); if (!stop.signal.aborted && v) note(k, v); }
        catch { if (!stop.signal.aborted) { note(k, { status: 'unavailable', text: LIVE_STATUS_TEXT.unavailable }); at = Date.now() - every + 15000; } }
        finally { busy = false; }
      };
      void tick(); const t = window.setInterval(() => void tick(), 2000);
      return () => { stop.abort(); window.clearInterval(t); off(); };
    }, [on[k]]); // eslint-disable-line react-hooks/exhaustive-deps
  };
  const xy = (p: DroneWhere) => ({ x: (p.lon - live.origin.lon) * 111320 * Math.cos(live.origin.lat * Math.PI / 180), y: (p.lat - live.origin.lat) * 110540 });
  const told = (status: LiveStatus, text: string): Info => ({ status, text: status === 'ok' || status === 'partial' ? text : LIVE_STATUS_TEXT[status] ?? text });

  loop('subway', 20000, 800, async (p, signal) => {
    const d = await subwayData(); if (!d || signal.aborted) return { status: 'unavailable', text: '역 정보를 불러오지 못했습니다' };
    liveState.subway = d;
    const kx = 111320 * Math.cos(p.lat * Math.PI / 180), dist = (s: { lat: number; lon: number }) => Math.hypot((s.lon - p.lon) * kx, (s.lat - p.lat) * 110540);
    const near = d.stations.filter(s => dist(s) < 3500);
    live.stations(near, s => d.lines[s.lines[0]]?.colour ?? '#86e5f2');
    // (the entrances round them: the public-facility answer, cached by the server and the browser)
    void liveApi.facilities(p.lat, p.lon, signal).then(r => { if (!signal.aborted && live.on.subway) live.exits(r.items.filter(f => f.kind === 'exit'), near); }).catch(() => {});
    const lines = [...new Set(d.stations.filter(s => dist(s) < 6000).flatMap(s => s.lines))].slice(0, 8);
    if (!lines.length) { live.trains(d, []); return { status: 'ok', text: `주변 역 ${near.length}곳 · 운행 노선 없음` }; }
    const r = await liveApi.trains(lines, signal);
    liveState.trains = r.items; liveState.trainsAt = Date.now(); liveState.emit();
    live.trains(d, r.items);
    return told(r.status, `역 ${near.length}곳 · 열차 ${r.items.length}대 (${lines.join(', ')}) · ${r.updated ?? ''} 기준`);
  }, () => { live.stations(null, () => ''); live.trains(null, null); live.exits(null, null); });

  loop('er', 60000, 2500, async (p, signal) => {
    const r = await liveApi.emergency(p.lat, p.lon, signal); live.rooms(r.items); liveState.rooms = r.items;
    const free = r.items.filter(i => (i.er ?? 0) > 0).length;
    return told(r.status, `응급실 ${r.items.length}곳 (8km) · 병상 있음 ${free}곳`);
  }, () => { live.rooms(null); liveState.rooms = []; });

  loop('bike', 60000, 700, async (p, signal) => {
    const r = await liveApi.bikes(p.lat, p.lon, signal); live.docks(r.items); liveState.docks = r.items;
    return told(r.status, `대여소 ${r.items.length}곳 · 자전거 ${r.items.reduce((n, b) => n + b.bikes, 0)}대 · ${r.updated ?? ''} 기준`);
  }, () => { live.docks(null); liveState.docks = []; });

  loop('parking', 120000, 1500, async (p, signal) => {
    const r = await liveApi.parking(p.lat, p.lon, signal); live.lots(r.items); liveState.lots = r.items;
    return told(r.status, `공영주차장 ${r.items.length}곳 (3km)`);
  }, () => { live.lots(null); liveState.lots = []; });

  loop('facility', 600000, 1500, async (p, signal) => {
    const r = await liveApi.facilities(p.lat, p.lon, signal);
    // (the official AED register where the server has it approved: it replaces OpenStreetMap's few)
    const official = await liveApi.aed(p.lat, p.lon, signal).catch(() => null);
    if (official?.status === 'ok' && official.items.length) r.items = [...r.items.filter(f => f.kind !== 'aed'), ...official.items].sort((a, b) => a.distance - b.distance);
    live.places(r.items); liveState.places = r.items;
    const count = (k: keyof typeof FACILITY) => r.items.filter(f => f.kind === k).length;
    return told(r.status, `공공시설 ${r.items.length - count('exit')}곳 (3km) · 소방 ${count('fire')} · 경찰 ${count('police')} · 보건소 ${count('health')} · AED ${count('aed')}`);
  }, () => { live.places(null); liveState.places = []; });

  loop('traffic', 60000, 900, async (p, signal) => {
    const { x, y } = xy(p), links = live.links(x, y, 1600);
    if (!links.length) return { status: 'loading', text: '주변 도로를 불러오는 중…' };
    const r = await liveApi.traffic(p.lat, p.lon, links, signal); live.traffic(r.speeds);
    const n = Object.keys(r.speeds).length;
    // (the provider answers link by link: asked again soon while it is still answering)
    if (r.pending) window.setTimeout(() => window.dispatchEvent(new Event('live-traffic-again')), 6000);
    return told(r.status, n ? `도로 ${n}구간 소통정보 · ${r.updated} 기준${r.pending ? ' · 추가 조회 중' : ''}` : r.pending ? '소통정보 조회 중…' : '이 지역은 소통정보가 제공되지 않습니다');
  }, () => live.traffic(null));
  // (asked again: re-run the traffic loop's request)
  const [again, setAgain] = useState(0);
  useEffect(() => { const f = () => setAgain(a => a + 1); window.addEventListener('live-traffic-again', f); return () => window.removeEventListener('live-traffic-again', f); }, []);
  useEffect(() => {
    if (!again || !live.on.traffic) return;
    const p = whereRef.current(); if (!p) return;
    const { x, y } = xy(p);
    void liveApi.traffic(p.lat, p.lon, live.links(x, y, 1600)).then(r => {
      if (!live.on.traffic) return; live.traffic(r.speeds);
      const n = Object.keys(r.speeds).length;
      if (n) note('traffic', told(r.status, `도로 ${n}구간 소통정보 · ${r.updated} 기준${r.pending ? ' · 추가 조회 중' : ''}`));
      if (r.pending && again < 12) window.setTimeout(() => window.dispatchEvent(new Event('live-traffic-again')), 6000);
    }).catch(() => {});
  }, [again]); // eslint-disable-line react-hooks/exhaustive-deps

  const any = LAYERS.some(l => on[l.kind]);
  return <div className="re-live-controls" onPointerDown={e => e.stopPropagation()}>
    <details open={open} onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
    <summary className="re-live-title">실시간 공공정보{any && !open ? ` · ${LAYERS.filter(l => on[l.kind]).map(l => l.icon).join('')}` : ''}</summary>
    <div className="re-live-chips" role="group" aria-label="실시간 공공정보 레이어">
      {LAYERS.map(l => <button key={l.kind} type="button" aria-pressed={on[l.kind]} className={on[l.kind] ? 'is-on' : ''} onClick={() => toggle(l.kind)} title={`${l.label} ${on[l.kind] ? '끄기' : '켜기'}`}>
        <i aria-hidden="true">{l.icon}</i>{l.label}</button>)}
    </div>
    {any && <ul className="re-live-status" role="status">
      {LAYERS.filter(l => on[l.kind] && info[l.kind]).map(l => <li key={l.kind} className={`is-${info[l.kind]!.status}`}><i aria-hidden="true">{l.icon}</i>{info[l.kind]!.text}</li>)}
    </ul>}
    {on.traffic && <div className="re-live-legend" aria-label="도로소통 범례"><span className="is-go">원활</span><span className="is-slow">서행</span><span className="is-jam">정체</span><small>도시고속 70·40 / 일반 25·15 km/h</small></div>}
    {(on.er || on.bike || on.parking || on.facility) && <button type="button" className="re-live-list-btn" onClick={() => openLive({ type: 'list' })}>📋 주변 종합 정보 목록</button>}
    {any && <small className="re-live-note">표지를 누르면 상세 정보 · 응급 상황은 119</small>}
    </details>
  </div>;
}
