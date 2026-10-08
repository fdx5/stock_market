import { useEffect, useRef, useState } from "react";
import { lastMapUrl } from "../browsingMemory";
import { useLanguage } from "../i18n/LanguageContext";
import { Link } from "../router";
import { useWatchlist } from "../useWatchlist";
import { recentStockUrl } from "../watchlist";
import "./readingTools.css";

const MAP_NAMES: Record<string, string> = { "/map": "코스피", "/kosdaq-map": "코스닥", "/sp500-map": "S&P 500", "/nasdaq100-map": "나스닥", "/realestate-map": "부동산" };

/** Public browser history only. Opening this menu never starts price polling. */
export default function ReadingTools({ route }: { route: string }) {
  const { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const { recents } = useWatchlist();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const mapUrl = lastMapUrl();
  useEffect(() => setOpen(false), [route]);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (!open) { if (el.open) el.close(); return; }
    el.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { if (el.open) el.close(); document.body.style.overflow = previous; };
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  return <>
    <div className={`reading-tools${route.split("?")[0].endsWith("/report") ? " is-report" : ""}`} aria-label={L("읽기 도구", "Reading tools")}>
      {mapUrl && !route.startsWith(mapUrl.split("?")[0]) && <Link to={mapUrl} className="reading-resume" title={MAP_NAMES[mapUrl.split("?")[0]]}>{L("지도 이어보기", "Resume map")} ↗</Link>}
      <button ref={trigger} type="button" className="reading-recents" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} aria-controls="recent-stocks-sheet">
        <span aria-hidden="true">◷</span> {L("최근 종목", "Recent stocks")} <b>{recents.length}</b>
      </button>
    </div>
    <dialog ref={dialog} id="recent-stocks-sheet" className="recent-sheet" aria-labelledby="recent-stocks-title" onCancel={(e) => { e.preventDefault(); close(); }} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="recent-sheet-inner">
        <header><div><small>K-STOCK HUB</small><h2 id="recent-stocks-title">{L("최근 본 종목", "Recently viewed stocks")}</h2></div><button type="button" onClick={close} aria-label={L("닫기", "Close")}>×</button></header>
        <p className="recent-sheet-note">{L("이 브라우저에서 최근 열어본 10개 종목 · 로그인 없이 이용", "Last 10 stocks opened in this browser · no sign-in needed")}</p>
        {recents.length ? <ol>{recents.slice(0, 10).map((stock, i) => <li key={stock.code}>
          <span className="recent-sheet-order">{String(i + 1).padStart(2, "0")}</span>
          <Link to={recentStockUrl(stock)} className="recent-sheet-stock"><b>{stock.name}</b><small>{stock.code} · {stock.market}{stock.asset_type === "ETF" ? " · ETF" : ""}</small></Link>
          <Link to={recentStockUrl(stock, true)} className="recent-sheet-report" aria-label={`${stock.name} ${L("한 장 보고서", "one-page report")}`}>{L("보고서", "Report")} ↗</Link>
        </li>)}</ol> : <div className="recent-sheet-empty"><p>{L("아직 열어본 종목이 없습니다.", "No stocks viewed yet.")}</p><Link to="/stocks">{L("종목 찾기", "Find a stock")} →</Link></div>}
        {mapUrl && <Link to={mapUrl} className="recent-sheet-map">{MAP_NAMES[mapUrl.split("?")[0]]} {L("지도에서 이어보기", "map · resume browsing")} →</Link>}
      </div>
    </dialog>
  </>;
}
