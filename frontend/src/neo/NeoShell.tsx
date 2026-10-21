import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "../router";
import { useLanguage } from "../i18n/LanguageContext";
import { useMarketIndices } from "../useMarketIndices";
import { useMarketTicker } from "../useMarketTicker";
import { pct } from "../desk2/lib";
import Colophon from "../desk2/Colophon";
import { NEO_GROUPS, neoRouteFamily, routeLabel } from "./navigation";
import { setDesignMode, setFxLevel, useDesignMode, useFxLevel, setFrameLight, useFrameLight } from "./settings";
import NeoIcon from "./NeoIcon";
import NeoLogo from "./NeoLogo";
import NeoHeaderClocks from "./NeoHeaderClocks";
import NeoFrameLights from "./NeoFrameLights";
import { useBroadsheetFonts } from "../desk2/fonts";
import DeskBgm from "../desk2/DeskBgm";
import BookmarkButton from "../components/BookmarkButton";
import "../desk2/desk2.css";
import "./neo.css";
import "./neoPages.css";
import "./neoCommand.css";
import "./neoAtlas.css";

const Finder = lazy(() => import("../desk2/Finder"));
function NeoPulse() {
  const { kospi, kosdaq } = useMarketIndices();
  const ticker = useMarketTicker();
  const values = [
    { name: "KOSPI", price: kospi?.close, change: kospi?.change_pct, to: "/index/kospi" },
    { name: "KOSDAQ", price: kosdaq?.close, change: kosdaq?.change_pct, to: "/index/kosdaq" },
    ...["^GSPC", "^NDX", "KRW=X", "BTC-USD"].map((symbol, i) => { const value = ticker.find(item => item.symbol === symbol); return { name: ["S&P 500", "NASDAQ 100", "USD/KRW", "BTC/USD"][i], price: value?.price, change: value?.change_pct, to: ["/sp500-map", "/nasdaq100-map", "/global", "/global"][i] }; }),
  ];
  return <div className="ng-pulse"><span className="ng-pulse-label"><i /> MARKET PULSE</span><div className="ng-pulse-values">{values.map(value => <Link key={value.name} to={value.to}><span>{value.name}</span><b>{value.price != null && Number.isFinite(value.price) && value.price > 0 ? value.price.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}</b><em className={value.change == null ? "" : value.change > 0 ? "is-up" : value.change < 0 ? "is-down" : "is-flat"}>{pct(value.change)}</em></Link>)}</div></div>;
}

export default function NeoShell({ path, children }: { path: string; children: ReactNode }) {
  const frameLight = useFrameLight();
  const design = useDesignMode();
  useBroadsheetFonts();
  const fx = useFxLevel();
  const { lang, setLang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const [panel, setPanel] = useState<"menu" | "settings" | null>(null);
  const [finder, setFinder] = useState(false);
  const [filter, setFilter] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const close = () => { setPanel(null); setFinder(false); returnFocus.current?.focus(); };
  const open = (next: "menu" | "settings" | "search", origin?: HTMLElement) => {
    returnFocus.current = origin ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setFilter("");
    if (next === "search") { setPanel(null); setFinder(true); } else { setFinder(false); setPanel(next); }
  };
  useEffect(() => { setPanel(null); setFinder(false); }, [path]);
  useEffect(() => {
    const show = () => open("search");
    window.addEventListener("neo:search", show);
    return () => window.removeEventListener("neo:search", show);
  }, []);
  useEffect(() => {
    if (design !== "neo") return;
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.isContentEditable || target?.matches("input,textarea,select");
      if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") || (event.key === "/" && !typing && !panel && !finder)) {
        event.preventDefault(); event.stopImmediatePropagation(); finder ? close() : open("search");
      } else if (event.key === "Escape" && panel) { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [design, panel, finder]);
  useEffect(() => {
    if (!panel) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const initial = panelRef.current?.querySelector<HTMLElement>("input") ?? panelRef.current?.querySelector<HTMLElement>("button,a");
    initial?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = [...(panelRef.current?.querySelectorAll<HTMLElement>("a[href],button:not(:disabled),input,select,[tabindex='0']") ?? [])].filter(el => el.getClientRects().length > 0);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", trap); };
  }, [panel]);

  if (design !== "neo") return <>{children}<button type="button" className="ng-preview-switch" onClick={() => setDesignMode("neo")}>K STOCK HUB {L("새 디자인", "New design")} ↗</button></>;
  const family = neoRouteFamily(path);
  const current = (to: string) => to.split("?")[0] === path;
  const navLink = (link: readonly [string, string, string]) => <Link key={link[0]} to={link[0]} aria-current={current(link[0]) ? "page" : undefined}><span>{link[lang === "ko" ? 1 : 2]}</span><NeoIcon name="chevron" /></Link>;
  return <div className={`ng-shell ng-family-${family}`} data-workspace={path === "/desk" ? "kr" : path === "/global" ? "us" : "atlas"}>
    <NeoFrameLights disabled={family === "immersive"} />
    <a className="ng-skip" href="#neo-content">{L("본문 바로가기", "Skip to content")}</a>
    <header className="ng-header">
      <Link to="/" className="ng-brand" aria-label="K Stock Hub home"><NeoLogo className="ng-brand-logo" /></Link>
      <nav className="ng-primary-nav" aria-label={L("주요 메뉴", "Primary navigation")}>
        {[["/desk", "마켓", "Markets"], ["/map", "맵", "Maps"], ["/etf", "ETF", "ETF"], ["/market-brief", "인텔리전스", "Intelligence"]].map(([to, ko, en]) => <Link key={to} to={to} aria-current={path === to ? "page" : undefined}>{L(ko, en)}</Link>)}
      </nav>
      <button type="button" className="ng-search-trigger" onClick={event => open("search", event.currentTarget)} aria-label={L("종목 및 페이지 검색", "Search stocks and pages")}><NeoIcon name="search" /><span>{L("종목 · 코드 · 페이지 검색", "Search stocks, symbols, pages")}</span><kbd>⌘ K</kbd></button>
      <div className="ng-header-tools"><button type="button" className="ng-language" onClick={() => setLang(lang === "ko" ? "en" : "ko")} aria-label={L("영어로 전환", "Switch to Korean")}>{lang === "ko" ? "EN" : "KO"}</button><button type="button" onClick={event => open("settings", event.currentTarget)} aria-label={L("화면 설정", "Display settings")}><NeoIcon name="settings" /></button><button type="button" className="ng-menu-trigger" onClick={event => open("menu", event.currentTarget)} aria-label={L("전체 메뉴", "All destinations")}><NeoIcon name="menu" /></button></div>
      <NeoHeaderClocks />
    </header>
    <div className="ng-top-rail"><NeoPulse /><div className="d2 ng-audio-toolbar"><DeskBgm variant="header" /></div></div>
    <aside className="ng-sidebar" aria-label={L("워크스페이스 탐색", "Workspace navigation")}>
      <div className="ng-sidebar-cap"><span>WORKSPACE</span><b>01 / KOSPIMAP</b></div>
      {NEO_GROUPS.map(group => <div className="ng-nav-group" key={group.id}><h2><NeoIcon name={group.icon} />{L(group.ko, group.en)}</h2><nav>{group.links.slice(0, group.id === "markets" || group.id === "maps" ? 5 : 4).map(navLink)}</nav></div>)}
      <button type="button" className="ng-directory-button" onClick={event => open("menu", event.currentTarget)}><NeoIcon name="layers" />{L("전체 서비스", "All destinations")}<span>↗</span></button>
      <div className="ng-sidebar-foot"><span className="ng-status-dot" /> NEO GENESIS <small>MARKET INTELLIGENCE SYSTEM</small></div>
    </aside>
    <div className="ng-workspace">
      <div className="ng-context"><span><Link to="/">KOSPIMAP</Link><i>/</i>{routeLabel(path, lang)}</span><span className="ng-audience-slot" /><span className="ng-context-meta"><i />{L("데이터 기반 마켓 인텔리전스", "DATA-DRIVEN MARKET INTELLIGENCE")}</span><button type="button" onClick={event => open("menu", event.currentTarget)} aria-label={L("다른 워크스페이스", "Change workspace")}><NeoIcon name="layers" /></button></div>
      <div className="ng-content" id="neo-content" tabIndex={-1}>{children}</div>
      {family !== "immersive" && <div className="ng-footer d2"><Colophon home="/" /><div className="ng-footer-extras"><a href="https://voltaris-nyyo.onrender.com/" target="_blank" rel="noopener noreferrer">VOLTARIS ↗</a><Link to="/support">{L("커피 한 잔 후원", "Support this project")} ↗</Link><button type="button" onClick={() => window.print()}>{L("인쇄 / PDF", "Print / PDF")}</button></div></div>}
    </div>
    <nav className="ng-mobile-nav" aria-label={L("하단 탐색", "Bottom navigation")}>
      {[["/", "home", "홈", "Home"], ["/map", "map", "맵", "Maps"], ["/desk", "chart", "시장", "Markets"], ["/news", "news", "뉴스", "News"]].map(([to, icon, ko, en]) => <Link key={to} to={to} aria-current={path === to ? "page" : undefined}><NeoIcon name={icon} /><span>{L(ko, en)}</span></Link>)}<button type="button" onClick={event => open("menu", event.currentTarget)} aria-label={L("전체 메뉴", "All destinations")}><NeoIcon name="menu" /><span>{L("더보기", "More")}</span></button>
    </nav>
    {panel && <div className="ng-modal-scrim" onClick={close}><div className={`ng-dialog ng-dialog-${panel}`} ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="ng-dialog-title" onClick={event => event.stopPropagation()}><div className="ng-dialog-head"><div><span className="ng-kicker">KOSPIMAP / CONTROL CENTER</span><h2 id="ng-dialog-title">{panel === "menu" ? L("모든 시장, 하나의 관제석", "Your market command center") : L("나의 관제 환경", "Your command environment")}</h2></div><button type="button" className="ng-icon-button" onClick={close} aria-label={L("닫기", "Close")}><NeoIcon name="close" /></button></div>
      {panel === "menu" ? <><label className="ng-directory-search"><NeoIcon name="search" /><input value={filter} onChange={event => setFilter(event.target.value)} placeholder={L("서비스 이름 검색", "Find a destination")} aria-label={L("전체 서비스 검색", "Search all destinations")} /></label>{filter && !NEO_GROUPS.some(group => group.links.some(link => `${link[1]} ${link[2]}`.toLowerCase().includes(filter.toLowerCase()))) && <p className="ng-directory-empty" role="status">{L("검색 결과가 없습니다.", "No matching destinations.")}</p>}<div className="ng-directory-grid">{NEO_GROUPS.map(group => <section key={group.id}><h3><NeoIcon name={group.icon} />{L(group.ko, group.en)}</h3>{group.links.filter(link => `${link[1]} ${link[2]}`.toLowerCase().includes(filter.toLowerCase())).map(navLink)}</section>)}</div><div className="ng-directory-extras"><a href="https://chs2147.github.io/mini-apps" target="_blank" rel="noopener noreferrer">Mini Apps ↗</a><a href="https://voltaris-nyyo.onrender.com/" target="_blank" rel="noopener noreferrer">VOLTARIS ↗</a><Link to="/support">{L("커피 한 잔 후원", "Support")} ↗</Link></div></> : <><section className="ng-setting-section"><h3>{L("비주얼 효과", "Visual effects")}</h3><p>{L("화면 장식과 움직임만 조절합니다. 시세·차트·3D 출력 해상도는 유지됩니다.", "Controls visual decoration and motion. Data, charts and 3D output resolution stay intact.")}</p><button type="button" className="ng-beam-toggle" aria-pressed={frameLight} onClick={() => setFrameLight(!frameLight)}><NeoIcon name="bolt" /><span>{L("프레임 광선", "Frame beams")}<small>{L("가장자리를 따라 흐르는 네온 빛", "Neon light travelling along frame edges")}</small></span><b>{frameLight ? "ON" : "OFF"}</b></button><div className="ng-fx-options" role="group" aria-label={L("효과 단계", "Effects level")}>{(["full", "balanced", "minimal"] as const).map(level => <button type="button" key={level} aria-pressed={fx === level} onClick={() => setFxLevel(level)}><NeoIcon name={level === "full" ? "spark" : level === "balanced" ? "layers" : "chart"} /><strong>{level === "full" ? "Full FX" : level === "balanced" ? "Balanced" : "Minimal FX"}</strong><small>{level === "full" ? L("국소 조명 · 미세 모션", "Accent light and micro motion") : level === "balanced" ? L("균형 잡힌 기본 효과", "Balanced by default") : L("정보 중심 · 장식 최소화", "Information first")}</small></button>)}</div><p className="ng-setting-note">{L("시스템의 ‘동작 줄이기’ 설정을 항상 우선합니다.", "Your system reduced-motion preference always takes priority.")}</p></section><section className="ng-setting-section"><h3>{L("도구", "Tools")}</h3><div className="ng-setting-actions"><BookmarkButton className="ng-bookmark-control" /><button type="button" onClick={() => { close(); window.print(); }}>{L("인쇄 / PDF 저장", "Print / save PDF")}</button><button type="button" onClick={() => { close(); setDesignMode("classic"); }}>{L("이전 디자인 보기", "View previous design")}</button></div></section></>}
    </div></div>}
    {finder && <Suspense fallback={null}><div className="d2 ng-finder-host"><Finder open={finder} onClose={close} /></div></Suspense>}
  </div>;
}
