import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";
import { Link, navigate } from "../../router";
import { useDocumentTitle } from "../../useDocumentTitle";
import Colophon from "../Colophon";
import Finder from "../Finder";
import Masthead from "../Masthead";
import { Marker, Skel } from "../parts";
import { eok, pct, toneOf, useL } from "../lib";
import { useBroadsheet, useFinderHotkey } from "../shell";
import "../pages.css";
import "./brief.css";

/* 오늘 브리핑 — the closing report, set as the paper's market column.
 *
 * The briefs themselves are written by the backend's nightly batch (see the
 * /api/market-brief endpoints) and nothing about them changes here: the same seven
 * subjects (KOSPI, KOSDAQ and five large caps), the same archive by date, the same
 * URL scheme (/market-brief/<date>/<slug>), sharing and printing. What changes is
 * the setting: the summary becomes the lede under a real headline, the analysis is
 * body copy in columns, key issues and checkpoints are boxed as a paper boxes its
 * 'what to watch', and the figures are one ruled strip.
 *
 * New here:
 *  - a comparison with the previous session's brief for the same subject — the
 *    close, breadth, foreign flow and turnover side by side with their change, so
 *    the report says how today differs from yesterday, not only what today was;
 *  - the archive as a strip of dates with ← / → keys to walk it;
 *  - sharing confirms in place instead of with an alert dialog. */

type Stock = { code: string; name: string; close: number; change_pct: number; volume: number; sector: string };

type Brief = {
  date: string;
  market: string;
  target_type?: "market" | "stock";
  code?: string;
  name?: string;
  created_at: string;
  index: {
    name?: string;
    close: number;
    change: number;
    change_pct: number;
    turnover?: number;
    marcap?: number;
    foreign_ratio?: number;
    per?: number;
    roe?: number;
    sector?: string;
    updated_at: string;
  };
  investor: { individual_amount: number; foreign_amount: number; institution_amount: number };
  breadth: { advance: number; decline: number; flat: number; advance_ratio: number };
  turnover_estimate: number;
  top_up: Stock[];
  top_down: Stock[];
  active: Stock[];
  sectors: { name: string; change_pct: number; marcap: number; count: number }[];
  headlines: { title: string; url?: string; stock: string; press?: string; date?: string }[];
  summary: string;
  analysis: string[];
  key_issues?: string[];
  checkpoints?: string[];
  disclaimer: string;
};

const TABS = [
  { id: "KOSPI", slug: "kospi", ko: "코스피", en: "KOSPI" },
  { id: "KOSDAQ", slug: "kosdaq", ko: "코스닥", en: "KOSDAQ" },
  { id: "SAMSUNG", slug: "samsung", ko: "삼성전자", en: "Samsung Elec.", code: "005930" },
  { id: "HYNIX", slug: "hynix", ko: "SK하이닉스", en: "SK hynix", code: "000660" },
  { id: "HYUNDAI", slug: "hyundai", ko: "현대차", en: "Hyundai Motor", code: "005380" },
  { id: "SKSQUARE", slug: "sksquare", ko: "SK스퀘어", en: "SK Square", code: "402340" },
  { id: "SEMCO", slug: "semco", ko: "삼성전기", en: "Samsung Electro-Mech.", code: "009150" },
] as const;

const ALIAS: Record<string, string> = {
  "005930": "SAMSUNG",
  SAMSUNG: "SAMSUNG",
  "000660": "HYNIX",
  HYNIX: "HYNIX",
  SKHYNIX: "HYNIX",
  "005380": "HYUNDAI",
  HYUNDAI: "HYUNDAI",
  "402340": "SKSQUARE",
  SKSQUARE: "SKSQUARE",
  "009150": "SEMCO",
  SEMCO: "SEMCO",
  KOSDAQ: "KOSDAQ",
  KOSPI: "KOSPI",
};

const jo = (won: number, en: boolean) => (en ? `₩${(won / 1e12).toFixed(1)}T` : `${(won / 1e12).toFixed(1)}조`);

function Bars({ items }: { items: { name: string; change_pct: number }[] }) {
  const max = Math.max(1, ...items.map((x) => Math.abs(x.change_pct || 0)));
  return (
    <ol className="bf-bars">
      {items.slice(0, 8).map((x) => {
        const v = x.change_pct || 0;
        return (
          <li key={x.name}>
            <span>{x.name}</span>
            <i className="bf-bar-track">
              <i className="sk-mid" />
              <i className={`sk-fill is-${toneOf(v)}`} style={v >= 0 ? { left: "50%", width: `${(Math.abs(v) / max) * 50}%` } : { right: "50%", width: `${(Math.abs(v) / max) * 50}%` }} />
            </i>
            <b className={`d2-num is-${toneOf(v)}`}>{pct(v)}</b>
          </li>
        );
      })}
    </ol>
  );
}

export default function BriefPage({ initialDate = "", initialMarket = "KOSPI" }: { initialDate?: string; initialMarket?: string }) {
  const { lang } = useLanguage();
  const en = lang === "en";
  const L = useL();
  useBroadsheet();
  const market = ALIAS[(initialMarket || "KOSPI").toUpperCase()] ?? "KOSPI";
  const tab = TABS.find((t) => t.id === market) ?? TABS[0];
  const [data, setData] = useState<Brief | null>(null);
  const [prev, setPrev] = useState<Brief | null>(null);
  const [history, setHistory] = useState<{ date: string; market: string }[]>([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [finderOpen, setFinderOpen] = useState(false);
  useFinderHotkey(setFinderOpen);
  const title = data?.name || L(tab.ko, tab.en);
  useDocumentTitle(data ? `${data.date} ${title} 오늘 브리핑 | K-Stock Hub` : "오늘 브리핑 | K-Stock Hub");

  useEffect(() => {
    fetch("/api/market-brief?limit=500")
      .then((r) => r.json())
      .then((r) => setHistory(r.items || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    fetch(initialDate ? `/api/market-brief/${initialDate}/${tab.slug}` : `/api/market-brief/latest/${tab.slug}`)
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((b: Brief) => {
        if (cancelled) return;
        setData(b);
        if (!initialDate) window.history.replaceState({}, "", `/market-brief/${b.date}/${tab.slug}`);
      })
      .catch(() => !cancelled && setError(L("오늘 브리핑을 불러오지 못했습니다.", "Could not load this briefing.")));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDate, tab.slug]);

  const dates = useMemo(() => [...new Set(history.filter((x) => x.market === market).map((x) => x.date))], [history, market]);
  const current = data?.date || initialDate;
  const i = dates.indexOf(current);
  const newer = i > 0 ? dates[i - 1] : "";
  const older = i >= 0 ? dates[i + 1] || "" : "";

  /* The previous session's brief, for the comparison strip. */
  useEffect(() => {
    let cancelled = false;
    setPrev(null);
    if (!older) return;
    fetch(`/api/market-brief/${older}/${tab.slug}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => !cancelled && setPrev(b))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [older, tab.slug]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft" && older) navigate(`/market-brief/${older}/${tab.slug}`);
      if (e.key === "ArrowRight" && newer) navigate(`/market-brief/${newer}/${tab.slug}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [older, newer, tab.slug]);

  const isStock = market !== "KOSPI" && market !== "KOSDAQ";
  const chg = data?.index?.change_pct ?? 0;
  const mood = isStock
    ? chg >= 2
      ? L("매수 집중", "Heavy buying")
      : chg > 0
        ? L("상승 흐름", "Rising")
        : chg <= -2
          ? L("위험회피 경계", "Risk-off")
          : chg < 0
            ? L("하락 조정", "Pulling back")
            : L("방향성 중립", "Neutral")
    : chg >= 2
      ? L("매수심리 우세", "Buyers in control")
      : chg > 0
        ? L("상승 흐름", "Rising")
        : chg <= -2
          ? L("위험회피 경계", "Risk-off")
          : chg < 0
            ? L("하락 조정", "Pulling back")
            : L("방향성 중립", "Neutral");

  const share = async () => {
    const u = new URL(window.location.href);
    u.searchParams.set("utm_source", "native_share");
    u.searchParams.set("utm_medium", "social");
    u.searchParams.set("utm_campaign", `market_brief_${data?.date || "latest"}`);
    try {
      if (navigator.share) await navigator.share({ title: `${data?.date} ${title} 오늘 브리핑`, text: data?.summary, url: u.toString() });
      else {
        await navigator.clipboard.writeText(u.toString());
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      /* closed */
    }
  };

  const go = (slug: string) => navigate(current ? `/market-brief/${current}/${slug}` : `/market-brief/latest/${slug}`);
  const flow = (v: number) => eok(v, lang);
  const diffs = data && prev
    ? [
        { k: L("종가", "Close"), now: data.index.close.toLocaleString(), was: prev.index.close.toLocaleString(), d: data.index.close - prev.index.close, fmt: (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}` },
        ...(!isStock
          ? [{ k: L("상승 비중", "Advancers"), now: `${data.breadth.advance_ratio.toFixed(1)}%`, was: `${prev.breadth.advance_ratio.toFixed(1)}%`, d: data.breadth.advance_ratio - prev.breadth.advance_ratio, fmt: (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%p` }]
          : []),
        { k: L("외국인 순매매", "Foreign net"), now: flow(data.investor.foreign_amount), was: flow(prev.investor.foreign_amount), d: data.investor.foreign_amount - prev.investor.foreign_amount, fmt: (v: number) => flow(v) },
        { k: L("거래대금", "Turnover"), now: jo(data.turnover_estimate, en), was: jo(prev.turnover_estimate, en), d: data.turnover_estimate - prev.turnover_estimate, fmt: (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${jo(Math.abs(v), en)}` },
      ]
    : [];

  return (
    <div className="d2 bf" lang={lang}>
      <a className="d2-skip" href="#bf-report">
        {L("본문 바로가기", "Skip to content")}
      </a>
      <Masthead
        onPrint={() => window.print()}
        section={{ ko: "오늘 브리핑", en: "The Closing Brief", taglineKo: "장이 끝난 뒤 쓰는 시황 — 가격·수급·확산·뉴스", taglineEn: "Written after the bell — price, flows, breadth and news" }}
      />

      <div className="d2-cmd bf-bar" data-d2-sticky>
        <div className="d2-cmd-inner bf-bar-inner">
          <Marker options={TABS.map((t) => ({ id: t.slug, label: L(t.ko, t.en) }))} value={tab.slug} onChange={go} label={L("브리핑 대상", "Subject")} className="bf-tabs" />
          <label className="bf-date">
            <span>{L("날짜", "Date")}</span>
            <select value={initialDate} onChange={(e) => navigate(e.target.value ? `/market-brief/${e.target.value}/${tab.slug}` : `/market-brief/latest/${tab.slug}`)}>
              <option value="">{L("최신", "Latest")}</option>
              {dates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <span className="bf-tools">
            <button type="button" onClick={share}>
              {copied ? L("링크 복사됨", "Link copied") : L("공유", "Share")}
            </button>
            <button type="button" onClick={() => window.print()}>
              {L("PDF·인쇄", "PDF · print")}
            </button>
          </span>
        </div>
      </div>

      <main className="d2-main" id="bf-report">
        {dates.length > 0 && (
          <nav className="bf-archive" aria-label={L("지난 브리핑", "Archive")}>
            <span>{L("지난 브리핑", "Archive")}</span>
            {dates.slice(0, 12).map((d) => (
              <Link key={d} to={`/market-brief/${d}/${tab.slug}`} className={d === current ? "is-on" : ""} aria-current={d === current ? "page" : undefined}>
                {d.slice(5).replace("-", ".")}
              </Link>
            ))}
            <small>{L("← → 키로 이동", "← → to move")}</small>
          </nav>
        )}

        {error && <p className="d2-empty">{error}</p>}
        {!data && !error && (
          <div className="sk-loading">
            <Skel h={50} w="70%" />
            <Skel h={20} w="90%" />
            <Skel h={260} />
          </div>
        )}

        {data && (
          <article className="bf-sheet">
            <header className="bf-head">
              <p className="d2-lead-kicker">
                <span>{L("장 마감 시황", "Closing report")}</span>
                <span>{data.date}</span>
                {data.code && <span className="bf-code">{data.code}</span>}
                <span>{data.created_at ? new Intl.DateTimeFormat(en ? "en-US" : "ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(data.created_at)) + L(" 작성", " filed") : ""}</span>
              </p>
              <div className="bf-head-grid">
                <div>
                  <h2>
                    {data.date.slice(5).replace("-", ".")} {title}, <em className={`is-${toneOf(chg)}`}>{pct(chg)}</em>
                  </h2>
                  <p className="bf-lede">{data.summary}</p>
                </div>
                <div className={`bf-stamp is-${toneOf(chg)}`}>
                  <small>{isStock ? L("종목 분위기", "Tone of the stock") : L("시장 분위기", "Tone of the market")}</small>
                  <b>{mood}</b>
                </div>
              </div>
            </header>

            <section className="bf-kpis" aria-label={L("핵심 수치", "Key figures")}>
              <div>
                <span>{L("종가", "Close")}</span>
                <b>
                  {data.index.close.toLocaleString()}
                  {isStock && <small>{L("원", " KRW")}</small>}
                </b>
                <em className={`is-${toneOf(data.index.change)}`}>
                  {data.index.change > 0 ? "▲" : data.index.change < 0 ? "▼" : "–"} {Math.abs(data.index.change).toLocaleString()} ({pct(chg)})
                </em>
              </div>
              <div>
                <span>{isStock ? L("외국인 지분율", "Foreign holding") : L("상승 종목 비중", "Advancers")}</span>
                <b>{isStock ? (data.index.foreign_ratio != null ? `${data.index.foreign_ratio.toFixed(1)}%` : "—") : `${data.breadth.advance_ratio.toFixed(1)}%`}</b>
                <em>
                  {isStock
                    ? `PER ${data.index.per ? data.index.per.toFixed(1) : "—"} · ROE ${data.index.roe ? `${data.index.roe.toFixed(1)}%` : "—"}`
                    : `${L("상승", "Up")} ${data.breadth.advance} · ${L("하락", "Down")} ${data.breadth.decline}`}
                </em>
              </div>
              <div>
                <span>{isStock ? L("당일 거래대금", "Turnover") : L("추정 거래대금", "Est. turnover")}</span>
                <b>{jo(data.turnover_estimate ?? 0, en)}</b>
                <em>{isStock ? L("거래량×종가", "volume × close") : L("종목 종가×거래량 합산", "sum of close × volume")}</em>
              </div>
              <div>
                <span>{L("외국인 순매매", "Foreign net")}</span>
                <b className={`is-${toneOf(data.investor.foreign_amount)}`}>{flow(data.investor.foreign_amount)}</b>
                <em>
                  {L("기관", "Inst.")} {flow(data.investor.institution_amount)} · {L("개인", "Indiv.")} {flow(data.investor.individual_amount)}
                </em>
              </div>
            </section>

            {diffs.length > 0 && prev && (
              <section className="bf-compare" aria-label={L("전 거래일 대비", "Against the previous session")}>
                <h3>
                  {L("전 거래일 브리핑 대비", "Against the previous brief")} <small>{prev.date}</small>
                </h3>
                <table>
                  <thead>
                    <tr>
                      <th />
                      <th>{prev.date.slice(5).replace("-", ".")}</th>
                      <th>{data.date.slice(5).replace("-", ".")}</th>
                      <th>{L("변화", "Change")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffs.map((r) => (
                      <tr key={r.k}>
                        <th scope="row">{r.k}</th>
                        <td className="d2-num sk-muted">{r.was}</td>
                        <td className="d2-num">{r.now}</td>
                        <td className={`d2-num is-${toneOf(r.d)}`}>{r.fmt(r.d)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            <section className="bf-body">
              <h3 className="sk-col-head">{L("시황 분석", "Analysis")}</h3>
              <div className="bf-columns">
                {(data.analysis || []).map((p, n) => (
                  <p key={n}>
                    {n === 0 && <b className="d2-lead-dateline">{L("【서울=마켓데스크】", "SEOUL —")}</b>}
                    {p}
                  </p>
                ))}
              </div>
            </section>

            {(data.key_issues?.length || data.checkpoints?.length) ? (
              <section className="bf-boxes">
                {data.key_issues && data.key_issues.length > 0 && (
                  <div className="bf-box">
                    <h4>{L("핵심 이슈", "Key issues")}</h4>
                    <ol>
                      {data.key_issues.map((x, n) => (
                        <li key={n}>{x}</li>
                      ))}
                    </ol>
                  </div>
                )}
                {data.checkpoints && data.checkpoints.length > 0 && (
                  <div className="bf-box is-watch">
                    <h4>{L("다음 거래일 확인할 것", "What to watch next session")}</h4>
                    <ol>
                      {data.checkpoints.map((x, n) => (
                        <li key={n}>{x}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </section>
            ) : null}

            <div className="bf-two">
              <section>
                <h3 className="sk-col-head">{isStock ? L("관련 종목 · 피어그룹 등락", "Peer group moves") : L("업종 온도계", "Sectors")}</h3>
                <Bars items={data.sectors || []} />
              </section>
              <section>
                <h3 className="sk-col-head">{isStock ? L("매수 강도", "Buying strength") : L("시장 확산도", "Breadth")}</h3>
                <div className="bf-breadth">
                  <b>
                    {(data.breadth?.advance_ratio ?? 50).toFixed(1)}
                    <small>%</small>
                  </b>
                  <span>{isStock ? L("매수 강도", "buying strength") : L("상승 종목 비중", "of names rose")}</span>
                </div>
                {!isStock ? (
                  <div className="d2-adbar" role="img" aria-label={`${data.breadth.advance} / ${data.breadth.flat} / ${data.breadth.decline}`}>
                    <span className="is-up" style={{ flexGrow: data.breadth.advance }}>{data.breadth.advance}</span>
                    <span className="is-flat" style={{ flexGrow: Math.max(data.breadth.flat, 1) }}>{data.breadth.flat}</span>
                    <span className="is-down" style={{ flexGrow: data.breadth.decline }}>{data.breadth.decline}</span>
                  </div>
                ) : (
                  <p className="bf-flows">
                    {L("외국인", "Foreign")} <b className={`is-${toneOf(data.investor.foreign_amount)}`}>{flow(data.investor.foreign_amount)}</b> · {L("기관", "Institutions")}{" "}
                    <b className={`is-${toneOf(data.investor.institution_amount)}`}>{flow(data.investor.institution_amount)}</b>
                  </p>
                )}
              </section>
            </div>

            <div className="bf-two">
              <section>
                <h3 className="sk-col-head">{isStock ? L("관련 주요 종목 · 거래대금", "Related names by turnover") : L("주도 종목 · 거래대금", "Leaders by turnover")}</h3>
                <table className="d2-table">
                  <tbody>
                    {(data.active || []).slice(0, 6).map((x) => (
                      <tr key={x.code}>
                        <td className="is-name">
                          <Link to={`/stock/${x.code}`}>{x.name}</Link>
                          <small className="bf-sub">{x.sector || (x.code === data.code ? L("본 종목", "this stock") : L("관련주", "related"))}</small>
                        </td>
                        <td className="d2-num">{jo(x.close * x.volume, en)}</td>
                        <td className={`d2-num is-${toneOf(x.change_pct)}`}>{pct(x.change_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section>
                <h3 className="sk-col-head">{isStock ? L("피어그룹 상승·하락 극점", "Peer extremes") : L("상승·하락 극점", "Biggest movers")}</h3>
                <table className="d2-table">
                  <tbody>
                    {[...(data.top_up || []).slice(0, 3), ...(data.top_down || []).slice(0, 3)].map((x, n) => (
                      <tr key={`${x.code}-${n}`}>
                        <td className="is-name">
                          <Link to={`/stock/${x.code}`}>{x.name}</Link>
                        </td>
                        <td className="d2-num">{x.close.toLocaleString()}</td>
                        <td className={`d2-num is-${toneOf(x.change_pct)}`}>{pct(x.change_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>

            {(data.headlines || []).length > 0 && (
              <section className="bf-news">
                <h3 className="sk-col-head">{isStock ? L(`${title} 마감 뉴스`, `${title} closing news`) : L("마감 뉴스 레이더", "Closing news")}</h3>
                <ol>
                  {data.headlines.map((x, n) => (
                    <li key={n}>
                      <a href={x.url || "#"} target="_blank" rel="noreferrer">
                        <small>{x.press || x.stock}</small>
                        <b>{x.title}</b>
                        <span>{L("원문", "Source")} ↗</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <footer className="bf-foot">
              <p>
                <b>{L("작성 방법", "Method")}</b> {L("공개 시세, 종목별 거래량, 시가총액 가중 업종·피어 수익률, 투자자별 순매매와 당일 관련 기사·공시를 자동으로 교차 집계했습니다.", "Public quotes, per-stock volume, cap-weighted sector and peer returns, investor flows and the day's related articles and filings, cross-tabulated automatically.")}
              </p>
              <p>{data.disclaimer}</p>
            </footer>

            <nav className="bf-next" aria-label={L("관련 지면", "Related pages")}>
              {isStock && data.code ? (
                <>
                  <Link to={`/stock/${data.code}`}>
                    {data.name} {L("종목면", "company page")} →
                  </Link>
                  <Link to="/fight">{L("시총 대결", "Market-cap fight")} →</Link>
                  <Link to="/map">{L("코스피 시가총액 맵", "KOSPI map")} →</Link>
                </>
              ) : (
                <>
                  <Link to={market === "KOSPI" ? "/map" : "/kosdaq-map"}>
                    {L(tab.ko, tab.en)} {L("시가총액 맵", "market map")} →
                  </Link>
                  <Link to={market === "KOSPI" ? "/kospi-100" : "/kosdaq-100"}>{L("거래대금·등락률 순위", "Rankings")} →</Link>
                  <Link to="/desk">{L("마켓 데스크 1면", "Market desk front page")} →</Link>
                </>
              )}
            </nav>

            <nav className="bf-pager" aria-label={L("브리핑 날짜 이동", "Move between briefs")}>
              {older ? <Link to={`/market-brief/${older}/${tab.slug}`}>← {older} {L("이전 브리핑", "earlier")}</Link> : <span />}
              {newer ? <Link to={`/market-brief/${newer}/${tab.slug}`}>{newer} {L("다음 브리핑", "later")} →</Link> : <span />}
            </nav>
          </article>
        )}
      </main>

      <Colophon />
      <Finder open={finderOpen} onClose={() => setFinderOpen(false)} />
    </div>
  );
}
