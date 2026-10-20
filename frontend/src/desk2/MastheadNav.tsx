import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link } from "../router";
import { reportVoltarisIngress } from "../useActivityTracking";
import { SITE_NAV } from "./siteNav";
import "./siteNav.css";

const CORE = ["/desk", "/global", "/map", "/kosdaq-map", "/sp500-map", "/nasdaq100-map"];
const MORE_ONLY = new Set(["/market-bubbles", "/kospi-orbit", "/fight", "/global-top100"]);
const PRIMARY = [
  ...CORE.map(to => SITE_NAV.find(item => item.to === to)!),
  ...SITE_NAV.filter(item => !CORE.includes(item.to) && !MORE_ONLY.has(item.to)),
];
const GROUPS = [
  { ko: "시장·종목", en: "Markets & stocks", paths: ["/desk", "/global", "/stocks", "/stock/005930", "/etf", "/kospi-100", "/global-top100"] },
  { ko: "시장 지도", en: "Market maps", paths: ["/map", "/kosdaq-map", "/sp500-map", "/nasdaq100-map", "/realestate-map"] },
  { ko: "투자정보·콘텐츠", en: "Investing & stories", paths: ["/investors", "/investment-videos", "/market-brief", "/news", "/discussion-explorer?code=005930&name=삼성전자&market=KR&asset=STOCK", "/ai-prediction"] },
  { ko: "시각화·탐험", en: "Explore", paths: ["/market-bubbles", "/kospi-orbit", "/fight", "/drone-explore"] },
];

function isCurrent(to: string, path: string) {
  const base = to.split("?")[0];
  return path === base || path === `${base}/` ||
    (base === "/stock/005930" && path.startsWith("/stock/")) ||
    ((base === "/investors" || base === "/ai-prediction") && path.startsWith(`${base}/`));
}

/** Keep the four maps visible. Additional links use only the space left after
 * the six core links and the disclosure button; none need sideways scrolling. */
export default function SiteNav({ lang, compact, path }: { lang: "ko" | "en"; compact: boolean; path: string }) {
  const [count, setCount] = useState(CORE.length);
  const [open, setOpen] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const label = (item: typeof SITE_NAV[number]) => {
    if (CORE.slice(2).includes(item.to)) {
      const names = lang === "ko" ? ["코스피", "코스닥", "S&P500", "나스닥"] : ["KOSPI", "KOSDAQ", "S&P500", "NASDAQ"];
      return names[CORE.indexOf(item.to) - 2] + (compact ? "" : lang === "ko" ? " 맵" : " map");
    }
    if (compact && item.to === "/global") return lang === "ko" ? "해외" : "US";
    if (compact && item.to === "/desk") return lang === "ko" ? "1면" : "Home";
    return lang === "ko" ? item.ko : item.en;
  };

  useLayoutEffect(() => {
    const fit = () => {
      if (!row.current || !measure.current || !button.current) return;
      const available = row.current.clientWidth - button.current.getBoundingClientRect().width - 2;
      const widths = Array.from(measure.current.children, child => child.getBoundingClientRect().width);
      let used = widths.slice(0, CORE.length).reduce((a, b) => a + b, 0);
      let next = CORE.length;
      while (next < widths.length && used + widths[next] <= available) used += widths[next++];
      setCount(previous => previous === next ? previous : next);
      nav.current?.style.setProperty("--nav-panel-space", `${Math.max(120, window.innerHeight - row.current.getBoundingClientRect().bottom - 12)}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (row.current) observer.observe(row.current);
    if (measure.current) Array.from(measure.current.children).forEach(child => observer.observe(child));
    if (button.current) observer.observe(button.current);
    window.addEventListener("resize", fit);
    document.fonts?.addEventListener("loadingdone", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
      document.fonts?.removeEventListener("loadingdone", fit);
    };
  }, [lang, compact, open]);

  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !nav.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        button.current?.focus();
      }
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("popstate", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("popstate", close);
    };
  }, [open]);

  const hiddenCurrent = !PRIMARY.slice(0, count).some(item => isCurrent(item.to, path));
  const link = (item: typeof SITE_NAV[number], short = false) => (
    <Link to={item.to} className={isCurrent(item.to, path) ? "is-here" : undefined}
      aria-current={isCurrent(item.to, path) ? "page" : undefined}
      title={lang === "ko" ? item.ko : item.en}>
      {short ? label(item) : lang === "ko" ? item.ko : item.en}
    </Link>
  );

  return (
    <nav className="d2-mast-nav d2-site-nav" ref={nav} aria-label={lang === "ko" ? "사이트 메뉴" : "Site sections"}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}>
      <div className="d2-site-nav-row" ref={row}>
        <ul className="d2-site-nav-primary">
          {PRIMARY.slice(0, count).map(item => <li key={item.to}>{link(item, true)}</li>)}
        </ul>
        <button className={`d2-site-nav-more${hiddenCurrent ? " is-here" : ""}`} ref={button}
          type="button" aria-expanded={open} aria-controls={panelId}
          aria-label={lang === "ko" ? "전체 메뉴 보기" : "View all sections"}
          onClick={() => setOpen(value => !value)}
          onKeyDown={event => {
            if (event.key !== "ArrowDown") return;
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => document.getElementById(panelId)?.querySelector<HTMLAnchorElement>("a")?.focus());
          }}>
          <span className="d2-site-nav-more-long">{lang === "ko" ? "전체 보기" : "View all"}</span>
          <span className="d2-site-nav-more-short">{lang === "ko" ? "전체" : "All"}</span>
          <span className="d2-site-nav-chevron" aria-hidden="true">⌄</span>
        </button>
      </div>
      <div className="d2-site-nav-measure" aria-hidden="true" ref={measure}>
        {PRIMARY.map(item => <span key={item.to}>{label(item)}</span>)}
      </div>
      {open && (
        <div className="d2-site-nav-panel" id={panelId} onClick={event => {
          if ((event.target as Element).closest("a")) setOpen(false);
        }}>
          {GROUPS.map(group => (
            <section key={group.en}>
              <h2>{lang === "ko" ? group.ko : group.en}</h2>
              <ul>{group.paths.map(to => {
                const item = SITE_NAV.find(entry => entry.to === to)!;
                return <li key={to}>{link(item)}</li>;
              })}</ul>
              {group.en === "Explore" && (
                <a href="https://voltaris-nyyo.onrender.com/" target="_blank" rel="noopener noreferrer"
                  onClick={() => reportVoltarisIngress(path)} className="is-ext">VOLTARIS ↗</a>
              )}
            </section>
          ))}
        </div>
      )}
    </nav>
  );
}
