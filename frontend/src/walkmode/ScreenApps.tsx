import { useEffect, useRef, useState } from "react";

/* The flat's screens as real web pages: the TV's YouTube browser (the site's own feed of investment
 * videos, played in YouTube's embedded player, full screen on request), and the laptop on the desk
 * running a web game laid exactly over its 3D screen (a CSS homography of the projected corners),
 * taking the real keyboard. youtube.com itself refuses to be framed; its embed player does not. */

// ------------------------------------------------------------------ the TV
interface Video { id: string; title: string; channel: string; views: number | null; thumbnail: string; length?: string | null }
const ID = /(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/;

/** The TV's own screen as a smart TV's YouTube app: laid over the 3D screen (as long as it faces the
 * eye), its home a wall of thumbnails; a video plays right there, and "크게 보기" goes full screen. */
export function TvBrowser({ corners, onOff, onPicture, zoom }: { corners: () => { x: number; y: number }[] | null; onOff(): void; onPicture(img: HTMLImageElement | null): void; zoom: Zoom }) {
  const [market, setMarket] = useState<"kr" | "us">("kr");
  const [items, setItems] = useState<Video[] | null>(null);
  const [err, setErr] = useState("");
  const [playing, setPlaying] = useState<Video | null>(null);
  const [link, setLink] = useState("");
  /** a search's results (null: the home feed) */
  const [found, setFound] = useState<{ q: string; items: Video[] | null } | null>(null);
  const box = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    setItems(null); setErr("");
    fetch(`/api/editorial/videos?market=${market}`).then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { items?: Video[] }) => { if (live) setItems(d.items ?? []); })
      .catch(() => { if (live) { setItems([]); setErr("영상 목록을 불러오지 못했습니다. 유튜브 링크를 붙여 넣어 보세요."); } });
    return () => { live = false; };
  }, [market]);
  // (kept on the TV's screen as it moves in the view; hidden when the TV is behind or turned away)
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = box.current; if (!el) return;
      const c = corners();
      if (!c) { el.style.visibility = "hidden"; return; }
      el.style.visibility = "visible"; el.style.transform = homography(TW, TH, c);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [corners]);
  // (the room's TV shows what is playing: its thumbnail, under the page)
  const play = (v: Video) => {
    setPlaying(v);
    const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => onPicture(img); img.src = `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
  };
  // the search box: a YouTube link plays at once; words are searched (the server asks YouTube)
  const search = () => {
    const q = link.trim(); if (!q) return;
    const m = ID.exec(q);
    if (m) { play({ id: m[1], title: "붙여 넣은 영상", channel: "", views: null, thumbnail: "" }); return; }
    setErr(""); setFound({ q, items: null });
    fetch(`/api/editorial/youtube/search?q=${encodeURIComponent(q)}`).then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { items?: Video[] }) => setFound(f => (f?.q === q ? { q, items: d.items ?? [] } : f)))
      .catch(() => { setFound(f => (f?.q === q ? { q, items: [] } : f)); setErr("검색하지 못했습니다. 잠시 뒤 다시 해 보세요."); });
  };
  const full = () => { void inner.current?.requestFullscreen?.(); unmute(); };
  // (a browser may start an embedded video muted: told through the player's own API to play aloud,
  // again a moment later as the player finishes starting, and from the 소리 button)
  const frame = useRef<HTMLIFrameElement>(null);
  const unmute = () => {
    const say = (func: string, args: unknown[] = []) => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
    for (const ms of [0, 800, 2000]) setTimeout(() => { say("unMute"); say("setVolume", [100]); say("playVideo"); }, ms);
  };
  return (
    <div className="wk-tvs" ref={box} style={{ width: TW, height: TH, visibility: "hidden" }} onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
     <div className="wk-tvs-in" ref={inner}>
      <div className="wk-tvs-bar">
        <span className="wk-tv-dot" /> <b>YouTube</b>
        {!playing && <>
          <button className={!found && market === "kr" ? "on" : ""} onClick={() => { setFound(null); setMarket("kr"); }}>국내 투자</button>
          <button className={!found && market === "us" ? "on" : ""} onClick={() => { setFound(null); setMarket("us"); }}>해외 투자</button>
          <form onSubmit={e => { e.preventDefault(); search(); }}><input value={link} onChange={e => setLink(e.target.value)} placeholder="유튜브 검색 (또는 영상 링크)" /><button>검색</button></form>
        </>}
        <div className="wk-tvs-actions">
          {playing && <button onClick={() => { setPlaying(null); onPicture(null); }}>{found ? "검색 결과" : "목록"}</button>}
          {playing && <button onClick={unmute}>🔊 소리</button>}
          <button onClick={() => zoom.set(!zoom.on)}>{zoom.on ? "축소" : "확대 🔍"}</button>
          <button className="is-main" onClick={full}>전체화면 ⛶</button>
          <button onClick={() => { onPicture(null); onOff(); }}>TV 끄기</button>
        </div>
      </div>
      {playing ? (
        <div className="wk-tvs-player">
          <iframe ref={frame} title={playing.title} src={`https://www.youtube-nocookie.com/embed/${playing.id}?autoplay=1&playsinline=1&rel=0&mute=0&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen onLoad={unmute} />
        </div>
      ) : found ? (
        <div className="wk-tvs-home">
          <div className="wk-tvs-found">‘{found.q}’ 검색 결과{found.items ? ` ${found.items.length}개` : ""}</div>
          {err && <p className="wk-warn">{err}</p>}
          {!found.items ? <div className="wk-bar"><i className="is-indeterminate" /></div> : (
            <div className="wk-tvs-list">
              {found.items.map(v => (
                <button key={v.id} className="wk-tvs-row" onClick={() => play(v)}>
                  <span className="wk-tvs-thumb"><img src={v.thumbnail || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`} alt="" loading="lazy" />{v.length && <em>{v.length}</em>}</span>
                  <span className="wk-tvs-meta"><b>{v.title}</b><small>{v.channel}{v.views ? ` · 조회수 ${v.views.toLocaleString()}회` : ""}</small></span>
                </button>
              ))}
              {found.items.length === 0 && !err && <p className="wk-warn">검색 결과가 없습니다.</p>}
            </div>
          )}
        </div>
      ) : (
        <div className="wk-tvs-home">
          {err && <p className="wk-warn">{err}</p>}
          {!items ? <div className="wk-bar"><i className="is-indeterminate" /></div> : (
            <div className="wk-tvs-grid">
              {items.map(v => (
                <button key={v.id} className="wk-tv-card" onClick={() => play(v)}>
                  <img src={v.thumbnail || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`} alt="" loading="lazy" />
                  <b>{v.title}</b><small>{v.channel}{v.views ? ` · 조회 ${v.views.toLocaleString()}` : ""}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
     </div>
    </div>
  );
}
const TW = 1280, TH = 720;
/** a screen's zoom: whether the eye is close in on it, and how to change that */
export interface Zoom { on: boolean; set(on: boolean): void }

// ------------------------------------------------------------------ the laptop
export const LAPTOP_URL = "https://cattower.code404.app/?debug=1&playShopKey=1";
const PW = 1240, PH = 802; // the page's size (the screen's 297×192 mm aspect)

/** the CSS matrix3d taking a w×h box to four points (top-left, top-right, bottom-right, bottom-left) */
function homography(w: number, h: number, p: { x: number; y: number }[]): string {
  const [a, b, c, d] = p;
  // the square → quad projective map (Heckbert), then pre-scaled by the box's size
  const dx1 = b.x - c.x, dx2 = d.x - c.x, dx3 = a.x - b.x + c.x - d.x;
  const dy1 = b.y - c.y, dy2 = d.y - c.y, dy3 = a.y - b.y + c.y - d.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den, hh = (dx1 * dy3 - dx3 * dy1) / den;
  const A = b.x - a.x + g * b.x, B = d.x - a.x + hh * d.x, C = a.x;
  const D = b.y - a.y + g * b.y, E = d.y - a.y + hh * d.y, F = a.y;
  const m = [A / w, D / w, 0, g / w, B / h, E / h, 0, hh / h, 0, 0, 1, 0, C, F, 0, 1];
  return `matrix3d(${m.map(v => +v.toFixed(8)).join(",")})`;
}

export function LaptopScreen({ corners, onClose, zoom }: { corners: () => { x: number; y: number }[] | null; onClose(): void; zoom: Zoom }) {
  const box = useRef<HTMLDivElement>(null), frame = useRef<HTMLIFrameElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let raf = 0, was = false;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const c = corners(), el = box.current;
      if (!el) return;
      if (!c) { el.style.visibility = "hidden"; if (was) { was = false; setShown(false); } return; }
      el.style.visibility = "visible"; el.style.transform = homography(PW, PH, c);
      if (!was) { was = true; setShown(true); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [corners]);
  // (zoomed in, the keyboard goes to the game)
  useEffect(() => { if (zoom.on) setTimeout(() => frame.current?.focus(), 700); }, [zoom.on]);
  return (
    <>
      <div className="wk-laptop" ref={box} style={{ width: PW, height: PH, visibility: "hidden" }}>
        <iframe ref={frame} title="노트북 게임" src={LAPTOP_URL} allow="autoplay; fullscreen; gamepad" allowFullScreen />
      </div>
      {shown && <div className="wk-laptop-bar" onPointerDown={e => e.stopPropagation()}>
        <span>노트북{zoom.on ? " · 키보드로 게임 조작" : ""}</span>
        <button className="wk-btn" onClick={() => zoom.set(!zoom.on)}>{zoom.on ? "축소" : "확대 🔍"}</button>
        <button className="wk-btn" onClick={() => { void box.current?.requestFullscreen?.(); setTimeout(() => frame.current?.focus(), 300); }}>전체화면 ⛶</button>
        {zoom.on && <button className="wk-btn" onClick={() => frame.current?.focus()}>키보드 연결</button>}
        <button className="wk-btn" onClick={onClose}>노트북 덮기</button>
      </div>}
    </>
  );
}
