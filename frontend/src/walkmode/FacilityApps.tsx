import { useEffect, useRef, useState } from "react";
import { homography } from "./ScreenApps";
import { DRINKS, type VendingSession } from "./interior/vending";
import { paintCanPreview } from "./interior/drinkArtwork";
import type { Drink } from "./interior/drinks";

export const FACILITY_HOME = "https://kospimap.com/map";
function CanPreview({ drink }: { drink: Drink }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) paintCanPreview(ref.current, drink); }, [drink]);
  return <canvas ref={ref} className="wk-can-preview" role="img" aria-label={`${drink.name} 캔 디자인`} />;
}
export function browserUrl(value: string): URL | null {
  const s = value.trim(); if (!s) return null;
  const host = /^(?:localhost|(?:[\w-]+\.)+[\w-]+)(?::\d+)?(?:[/?#]|$)/i.test(s);
  if (/^[a-z][a-z\d+.-]*:/i.test(s) && !/^https?:\/\//i.test(s) && !host) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(s) ? s : host ? `https://${s}` : `https://www.google.com/search?q=${encodeURIComponent(s)}`);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    if (/(^|\.)kospimap\.com$/i.test(url.hostname) || url.origin === location.origin) url.searchParams.set("inframe", "1");
    return url;
  } catch { return null; }
}
export function VendingMenu({ session, onClose }: { session: VendingSession; onClose(): void }) {
  const [group, setGroup] = useState("전체"), [chosen, setChosen] = useState("");
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => { if (!chosen) return; const t = setTimeout(() => close.current(), 300); return () => clearTimeout(t); }, [chosen]);
  return <div className="wk-fac-shade" onPointerDown={e => e.stopPropagation()}>
    <section className="wk-fac-panel" role="dialog" aria-modal="true" aria-labelledby="vending-title" onKeyDown={e => e.stopPropagation()}>
      <div className="wk-fac-heading"><h2 id="vending-title">음료 자판기</h2><button className="wk-btn" autoFocus onClick={onClose}>닫기 · Esc</button></div>
      <p>원하는 음료를 고르면 아래 배출구로 나옵니다.</p>
      <div className="wk-drink-tabs">{["전체", ...new Set(DRINKS.map(d => d.group))].map(g => <button className={`wk-btn${g === group ? " on" : ""}`} key={g} onClick={() => setGroup(g)}>{g}</button>)}</div>
      <div className="wk-drinks">{DRINKS.filter(d => group === "전체" || d.group === group).map(d => <button key={d.id} disabled={!!chosen} onClick={() => { if (session.dispense(d)) setChosen(d.name); }}><CanPreview drink={d} /><span>{d.name}</span><small>{d.group}</small></button>)}</div>
      <p role="status">{chosen ? `${chosen} 선택 완료 · 음료가 나옵니다.` : `총 ${DRINKS.length}종 · 체험용 음료`}</p>
    </section>
  </div>;
}

/** Only the computer being used owns an iframe. Idle monitors share a home-page texture. */
export function FacilityBrowser({ corners, onClose, onZoom }: { corners(): { x: number; y: number }[] | null; onClose(): void; onZoom(on: boolean): void }) {
  const home = browserUrl(FACILITY_HOME)!.href;
  const [visits, setVisits] = useState({ urls: [home], index: 0 }), [address, setAddress] = useState(FACILITY_HOME);
  const [source, setSource] = useState({ url: home, key: 0 });
  const [zoom, setZoom] = useState(true), [slow, setSlow] = useState(false), [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null), frame = useRef<HTMLIFrameElement>(null), src = source.url;
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const message = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data?.type === "facility-close") { close.current(); return; }
      if (e.data?.type !== "facility-navigation" || typeof e.data.url !== "string") return;
      const u = browserUrl(e.data.url);
      if (!u || u.origin !== e.origin || !(u.origin === location.origin || /(^|\.)kospimap\.com$/i.test(u.hostname))) return;
      setVisits(v => v.urls[v.index] === u.href ? v : { urls: [...v.urls.slice(0, v.index + 1), u.href], index: v.index + 1 });
      setAddress(u.href);
    };
    window.addEventListener("message", message); return () => window.removeEventListener("message", message);
  }, []);
  useEffect(() => {
    let raf = 0;
    const tick = () => { raf = requestAnimationFrame(tick); const c = corners(), el = box.current; if (!el) return; el.style.visibility = c ? "visible" : "hidden"; if (c) el.style.transform = homography(1200, 695, c); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [corners]);
  useEffect(() => { setSlow(false); const timer = setTimeout(() => setSlow(true), 8000); return () => clearTimeout(timer); }, [src]);
  const navigate = (value: string) => {
    const u = browserUrl(value); if (!u) { setError("http 또는 https 주소를 입력해 주세요."); return; }
    setError(""); setAddress(u.href); setVisits(v => ({ urls: [...v.urls.slice(0, v.index + 1), u.href], index: v.index + 1 })); setSource(s => ({ url: u.href, key: s.key + 1 }));
  };
  const back = () => {
    if (visits.index > 0) { const url = visits.urls[visits.index - 1]; setVisits(v => ({ ...v, index: v.index - 1 })); setAddress(url); setSource(s => ({ url, key: s.key + 1 })); return; }
    // Same-origin links inside the page participate in the real frame history too.
    try { const w = frame.current?.contentWindow; if (w && w.location.href !== "about:blank" && w.location.href !== src) w.history.back(); } catch { /* cross-origin frame history is private to the browser */ }
  };
  const currentUrl = visits.urls[visits.index], external = !/(^|\.)kospimap\.com$/i.test(new URL(currentUrl).hostname);
  return <>
    <div className="wk-fac-browser" ref={box} style={{ width: 1200, height: 695, visibility: "hidden" }} onPointerDown={e => e.stopPropagation()}>
      <iframe key={source.key} ref={frame} name="facility-browser" title="시설 컴퓨터 웹 브라우저" src={src} {...{ credentialless: "" }} referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" onError={() => setSlow(true)} />
    </div>
    <div className="wk-browser-controls" role="dialog" aria-label="컴퓨터 브라우저" onPointerDown={e => e.stopPropagation()}>
      <form onSubmit={e => { e.preventDefault(); navigate(address); }}>
        <button className="wk-btn" type="button" onClick={back}>뒤로</button><button className="wk-btn" type="button" onClick={() => navigate(FACILITY_HOME)}>홈</button>
        <input aria-label="웹 주소 또는 검색어" value={address} onChange={e => setAddress(e.target.value)} autoFocus /><button className="wk-btn">이동 / 검색</button>
        <button className="wk-btn" type="button" onClick={() => { onZoom(!zoom); setZoom(!zoom); }}>{zoom ? "축소" : "확대"}</button><button className="wk-btn" type="button" onClick={onClose}>닫기 · Esc</button>
      </form>
      <div className="wk-browser-status">{error || (slow ? "페이지가 열리지 않으면 새 탭에서 이용해 주세요." : external ? "외부 사이트는 화면 안에서 열리지 않을 수 있습니다." : "KOSPI MAP · 웹사이트를 탐색해 보세요.")} <a href={currentUrl} target="_blank" rel="noopener noreferrer">새 탭에서 열기 ↗</a></div>
    </div>
  </>;
}
