import { CSSProperties, useEffect, useMemo, useState } from "react";
import { BoardPost, EtfItem, GlobalDiscussionPost, api } from "../api/client";
import { Link } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import BattleIcon from "./BattleIcon";
import BoardPanel from "./BoardPanel";
import DashboardIcon from "./DashboardIcon";
import DiscussionIcon from "./DiscussionIcon";
import EtfIcon from "./EtfIcon";
import MarketBubbleNavLink from "./MarketBubbleNavLink";
import Footer from "./Footer";
import GlobalNewsIcon from "./GlobalNewsIcon";
import GlobalBoardPanel from "./GlobalBoardPanel";
import GlobeRankIcon from "./GlobeRankIcon";
import LanguageToggle from "./LanguageToggle";
import Logo from "./Logo";
import MarketIcon from "./MarketIcon";
import PredictIcon from "./PredictIcon";
import RankIcon from "./RankIcon";
import ThemeToggle from "./ThemeToggle";
import "../etfPage.css";

type Region = "KR" | "US";
type SortKey =
  "volume" | "turnover" | "change" | "d20" | "d60" | "d120" | "name";

function KoreaFlag() {
  return (
    <svg className="etf-korea-flag" viewBox="0 0 36 24" aria-hidden="true">
      <rect
        x=".5"
        y=".5"
        width="35"
        height="23"
        rx="2.5"
        fill="#fff"
        stroke="#d8dce5"
      />
      <g transform="translate(18 12) rotate(-33)">
        <path
          d="M-6 0a6 6 0 0 1 12 0 3 3 0 0 0-6 0 3 3 0 0 1-6 0Z"
          fill="#cd2e3a"
        />
        <path
          d="M6 0a6 6 0 0 1-12 0 3 3 0 0 0 6 0 3 3 0 0 1 6 0Z"
          fill="#0047a0"
        />
      </g>
      <g fill="#111">
        <path d="m6 5 5-3 .7 1.15-5 3zm1.15 1.85 5-3 .7 1.15-5 3zm17.7 10.3 5-3 .7 1.15-5 3zm1.15 1.85 5-3 .7 1.15-5 3zM25 3l5 3-.7 1.15-5-3zm-1.15 1.85 5 3-.7 1.15-5-3zM6 19l5-3 .7 1.15-5 3zm1.15 1.85 5-3 .7 1.15-5 3z" />
      </g>
    </svg>
  );
}

function CardViewIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1" y="1" width="6.2" height="6.2" rx="1.4" fill="currentColor" opacity="0.55" />
      <rect x="8.8" y="1" width="6.2" height="6.2" rx="1.4" fill="currentColor" />
      <rect x="1" y="8.8" width="6.2" height="6.2" rx="1.4" fill="currentColor" />
      <rect x="8.8" y="8.8" width="6.2" height="6.2" rx="1.4" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

function TableViewIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1" y="2" width="14" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1 6.4h14M6.2 6.4v7.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function GlobalGlobe() {
  return (
    <svg className="etf-global-globe" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="etf-globe-fill" x1="4" y1="3" x2="20" y2="21">
          <stop stopColor="#22d3ee" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <circle
        cx="12"
        cy="12"
        r="9.5"
        fill="url(#etf-globe-fill)"
        stroke="#fff"
        strokeWidth="1.4"
      />
      <path
        d="M2.8 12h18.4M12 2.7c2.4 2.6 3.6 5.7 3.6 9.3S14.4 18.7 12 21.3C9.6 18.7 8.4 15.6 8.4 12S9.6 5.3 12 2.7ZM4.8 7.1h14.4M4.8 16.9h14.4"
        fill="none"
        stroke="#effcff"
        strokeWidth="1.15"
        strokeLinecap="round"
        opacity=".95"
      />
    </svg>
  );
}

const money = (value: number, currency: string) =>
  new Intl.NumberFormat(currency === "KRW" ? "ko-KR" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  }).format(value);
const compact = (value: number) =>
  new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
const pct = (value: number | null | undefined) =>
  value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const tone = (value: number | null | undefined) =>
  value == null ? "flat" : value > 0 ? "up" : value < 0 ? "down" : "flat";

function Sparkline({
  values,
  direction,
}: {
  values: number[];
  direction: string;
}) {
  if (values.length < 2)
    return <div className="etf-spark-empty">차트 준비 중</div>;
  const min = Math.min(...values),
    max = Math.max(...values),
    span = max - min || 1;
  const points = values
    .map(
      (v, i) =>
        `${(i / (values.length - 1)) * 260},${70 - ((v - min) / span) * 62}`,
    )
    .join(" ");
  return (
    <svg
      className={`etf-spark ${direction}`}
      viewBox="0 0 260 76"
      preserveAspectRatio="none"
      aria-label="최근 60거래일 가격 추이"
    >
      <polyline points={points} />
    </svg>
  );
}

type RollingDiscussion = { id: string; title: string };

function EtfCard({
  item,
  rank,
  discussions,
  onBoard,
}: {
  item: EtfItem;
  rank: number;
  discussions: RollingDiscussion[];
  onBoard: (item: EtfItem, nid?: string) => void;
}) {
  const range =
    item.week52_high && item.week52_low && item.week52_high !== item.week52_low
      ? Math.min(
          100,
          Math.max(
            0,
            ((item.close - item.week52_low) /
              (item.week52_high - item.week52_low)) *
              100,
          ),
        )
      : null;
  return (
    <article className="etf-card" data-tone={tone(item.change_pct)}>
      <div className="etf-card-head">
        <span className="etf-rank">{rank}</span>
        <div className="etf-identity">
          <strong>{item.name}</strong>
          <span>
            {item.code} · {item.benchmark}
          </span>
        </div>
        <span className={`etf-change ${tone(item.change_pct)}`}>
          {pct(item.change_pct)}
        </span>
      </div>
      <div className="etf-tags">
        <span>{item.category}</span>
        {item.session !== "regular" && (
          <span className="session">
            {item.session === "pre" ? "프리마켓" : "애프터마켓"}
          </span>
        )}
      </div>
      <div className="etf-price">
        <strong>{money(item.close, item.currency)}</strong>
        <span className={tone(item.change)}>
          {item.change >= 0 ? "+" : ""}
          {money(item.change, item.currency)}
        </span>
      </div>
      <Sparkline values={item.sparkline} direction={tone(item.change_pct)} />
      <div className="etf-periods">
        <div>
          <span>20일</span>
          <b className={tone(item.returns.d20)}>{pct(item.returns.d20)}</b>
        </div>
        <div>
          <span>60일</span>
          <b className={tone(item.returns.d60)}>{pct(item.returns.d60)}</b>
        </div>
        <div>
          <span>120일</span>
          <b className={tone(item.returns.d120)}>{pct(item.returns.d120)}</b>
        </div>
      </div>
      <div className="etf-stats">
        <div>
          <span>거래량</span>
          <b>{compact(item.volume)}주</b>
        </div>
        <div>
          <span>거래대금</span>
          <b>
            {compact(item.turnover)} {item.currency}
          </b>
        </div>
        <div>
          <span>YTD</span>
          <b className={tone(item.returns.ytd)}>{pct(item.returns.ytd)}</b>
        </div>
      </div>
      <div className="etf-range">
        <div>
          <span>
            52주 최저{" "}
            {item.week52_low == null
              ? "—"
              : money(item.week52_low, item.currency)}
          </span>
          <span>
            최고{" "}
            {item.week52_high == null
              ? "—"
              : money(item.week52_high, item.currency)}
          </span>
        </div>
        <div className="etf-range-track">
          <i style={{ width: `${range ?? 0}%` }} />
        </div>
      </div>
      <>
        <div className="etf-discussion-ticker" aria-label="최근 종목 토론글">
          <span className="etf-discussion-label">최근 토론</span>
          {discussions.length > 0 ? (
            <div className="etf-discussion-window">
              <div
                className="etf-discussion-track"
                style={
                  {
                    "--ticker-count": discussions.length,
                    "--ticker-duration": `${Math.max(18, discussions.length * 3)}s`,
                  } as CSSProperties
                }
              >
                {[...discussions, discussions[0]].map((post, index) => (
                  <button
                    key={`${post.id}-${index}`}
                    type="button"
                    onClick={() => onBoard(item, post.id)}
                    title={post.title}
                  >
                    {post.title}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <span className="etf-discussion-empty">최근 글이 없습니다</span>
          )}
        </div>
        <div className="etf-card-actions">
          <button
            className="etf-board-button"
            type="button"
            onClick={() => onBoard(item)}
          >
            토론방 <span>›</span>
          </button>
          <Link
            className="etf-explorer-button"
            to={`/discussion-explorer?code=${encodeURIComponent(item.code)}&name=${encodeURIComponent(item.name)}&market=${item.region}&asset=ETF`}
          >
            3D 탐험 <span>✦</span>
          </Link>
        </div>
      </>
    </article>
  );
}

const TABLE_COLUMNS: { key: SortKey; label: string; align?: "left" }[] = [
  { key: "name", label: "종목", align: "left" },
  { key: "change", label: "현재가 · 등락" },
  { key: "d20", label: "20일" },
  { key: "d60", label: "60일" },
  { key: "d120", label: "120일" },
  { key: "volume", label: "거래량" },
  { key: "turnover", label: "거래대금" },
];

function EtfTable({
  items,
  discussions,
  globalDiscussions,
  sort,
  setSort,
  onBoard,
}: {
  items: EtfItem[];
  discussions: Record<string, BoardPost[]>;
  globalDiscussions: Record<string, GlobalDiscussionPost[]>;
  sort: SortKey;
  setSort: (key: SortKey) => void;
  onBoard: (item: EtfItem, nid?: string) => void;
}) {
  return (
    <div className="etf-table-wrap">
      <table className="etf-table">
        <thead>
          <tr>
            <th className="etf-table-rank">#</th>
            {TABLE_COLUMNS.map((col) => (
              <th
                key={col.key}
                className={`${col.align === "left" ? "etf-table-left" : ""} ${sort === col.key ? "is-sorted" : ""}`}
              >
                <button type="button" onClick={() => setSort(col.key)}>
                  {col.label}
                  {sort === col.key && <i className="etf-table-sort-caret" aria-hidden="true" />}
                </button>
              </th>
            ))}
            <th className="etf-table-left">추이</th>
            <th className="etf-table-left">52주 위치</th>
            <th className="etf-table-left">토론</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const range =
              item.week52_high && item.week52_low && item.week52_high !== item.week52_low
                ? Math.min(
                    100,
                    Math.max(
                      0,
                      ((item.close - item.week52_low) / (item.week52_high - item.week52_low)) * 100,
                    ),
                  )
                : null;
            const discussionCount =
              (item.region === "KR" ? discussions[item.code]?.length : globalDiscussions[item.code]?.length) ?? 0;
            return (
              <tr key={item.code} data-tone={tone(item.change_pct)}>
                <td className="etf-table-rank">{index + 1}</td>
                <td className="etf-table-name">
                  <div>
                    <strong>{item.name}</strong>
                    <span>
                      {item.code} · {item.benchmark}
                    </span>
                  </div>
                  <span className="etf-table-category">{item.category}</span>
                </td>
                <td className="etf-table-price">
                  <strong>{money(item.close, item.currency)}</strong>
                  <span className={tone(item.change_pct)}>{pct(item.change_pct)}</span>
                </td>
                <td className={`etf-table-num ${tone(item.returns.d20)}`}>{pct(item.returns.d20)}</td>
                <td className={`etf-table-num ${tone(item.returns.d60)}`}>{pct(item.returns.d60)}</td>
                <td className={`etf-table-num ${tone(item.returns.d120)}`}>{pct(item.returns.d120)}</td>
                <td className="etf-table-num">{compact(item.volume)}</td>
                <td className="etf-table-num">
                  {compact(item.turnover)} {item.currency}
                </td>
                <td className="etf-table-spark">
                  <Sparkline values={item.sparkline} direction={tone(item.change_pct)} />
                </td>
                <td className="etf-table-range">
                  <div className="etf-table-range-track">
                    <i style={{ width: `${range ?? 0}%` }} />
                  </div>
                </td>
                <td className="etf-table-actions">
                  <button type="button" onClick={() => onBoard(item)} title={`${item.name} 토론방`}>
                    토론 {discussionCount > 0 && <b>{discussionCount}</b>}
                  </button>
                  <Link
                    to={`/discussion-explorer?code=${encodeURIComponent(item.code)}&name=${encodeURIComponent(item.name)}&market=${item.region}&asset=ETF`}
                    title={`${item.name} 3D 탐험`}
                  >
                    3D ✦
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function EtfPage() {
  useDocumentTitle("ETF 마켓 · K-Stock Hub");
  const [region, setRegion] = useState<Region>("KR");
  const [viewMode, setViewMode] = useState<"card" | "table">("card");
  const [byRegion, setByRegion] = useState<Record<Region, EtfItem[]>>({
    KR: [],
    US: [],
  });
  const [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("turnover");
  const [category, setCategory] = useState("전체");
  const [boardItem, setBoardItem] = useState<EtfItem | null>(null);
  const [boardNid, setBoardNid] = useState<string | null>(null);
  const [discussions, setDiscussions] = useState<Record<string, BoardPost[]>>(
    {},
  );
  const [globalDiscussions, setGlobalDiscussions] = useState<
    Record<string, GlobalDiscussionPost[]>
  >({});

  useEffect(() => {
    let cancelled = false;
    const load = (initial = false) => {
      if (initial) setLoading(true);
      api
        .etfs(region)
        .then((res) => {
          if (!cancelled) {
            setByRegion((prev) => ({ ...prev, [region]: res.items }));
            setUpdatedAt(res.updated_at);
            setError("");
          }
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load(true);
    const timer = window.setInterval(() => load(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [region]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      Promise.all([api.etfDiscussions(), api.etfGlobalDiscussions()])
        .then(([kr, us]) => {
          if (!cancelled) {
            setDiscussions(kr.items);
            setGlobalDiscussions(us.items);
          }
        })
        .catch(() => {});
    load();
    const timer = window.setInterval(load, 180_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const openBoard = (item: EtfItem, nid?: string) => {
    setBoardNid(nid ?? null);
    setBoardItem(item);
  };

  const items = byRegion[region];
  const categories = useMemo(
    () => ["전체", ...Array.from(new Set(items.map((item) => item.category)))],
    [items],
  );
  const suggestions = useMemo(
    () =>
      query.trim()
        ? items
            .filter((item) =>
              `${item.name} ${item.code} ${item.benchmark}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .slice(0, 6)
        : [],
    [items, query],
  );
  const visible = useMemo(
    () =>
      items
        .filter(
          (item) =>
            (category === "전체" || item.category === category) &&
            `${item.name} ${item.code} ${item.benchmark}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
        )
        .sort((a, b) => {
          if (sort === "name") return a.name.localeCompare(b.name, "ko");
          if (sort === "change") return b.change_pct - a.change_pct;
          if (sort === "d20" || sort === "d60" || sort === "d120")
            return (
              (b.returns[sort] ?? -Infinity) - (a.returns[sort] ?? -Infinity)
            );
          return b[sort] - a[sort];
        }),
    [items, category, query, sort],
  );
  const leaders = items.slice().sort((a, b) => b.volume - a.volume);
  const totalTurnover = items.reduce((sum, item) => sum + item.turnover, 0);
  const advancers = items.filter((item) => item.change_pct > 0).length;
  const decliners = items.filter((item) => item.change_pct < 0).length;
  const breadth = items.length ? (advancers / items.length) * 100 : 50;
  const radarItems = items
    .slice()
    .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct))
    .slice(0, 7);

  return (
    <div className="app etf-page">
      <header className="app-header">
        <div className="app-title-row">
          <Link to="/" className="app-brand" aria-label="K-Stock Hub">
            <Logo className="app-logo-wide" />
          </Link>
          <div className="app-header-meta">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
        <div className="app-nav-row">
          <Link
            to="/desk"
            className="kospi-map-nav-link kospi-map-nav-link--home"
          >
            <DashboardIcon /> 홈
          </Link>
          <Link
            to="/market-brief"
            className="kospi-map-nav-link kospi-map-nav-link--brief"
          >
            오늘 브리핑
          </Link>
          <Link to="/map" className="kospi-map-nav-link">
            <MarketIcon /> KOSPI
          </Link>
          <Link
            to="/kosdaq-map"
            className="kospi-map-nav-link kospi-map-nav-link--kosdaq"
          >
            <MarketIcon /> KOSDAQ
          </Link>
          <Link
            to="/sp500-map"
            className="kospi-map-nav-link kospi-map-nav-link--sp500"
          >
            <MarketIcon /> S&P500
          </Link>
          <Link
            to="/nasdaq100-map"
            className="kospi-map-nav-link kospi-map-nav-link--nasdaq"
          >
            <MarketIcon /> NASDAQ100
          </Link>
          <Link
            to="/etf"
            className="kospi-map-nav-link kospi-map-nav-link--etf is-active"
          >
            <EtfIcon /> ETF
          </Link>
          <Link
            to="/discussion-explorer?code=005930&name=삼성전자&market=KR&asset=STOCK"
            className="kospi-map-nav-link kospi-map-nav-link--discussion"
          >
            <DiscussionIcon /> 종목토론
          </Link>
          <MarketBubbleNavLink />
          <Link
            to="/kospi-100"
            className="kospi-map-nav-link kospi-map-nav-link--top100"
          >
            <RankIcon /> TOP 100
          </Link>
          <Link
            to="/ai-prediction"
            className="kospi-map-nav-link kospi-map-nav-link--predict"
          >
            <PredictIcon /> AI 예측
          </Link>
          <Link
            to="/global-top100"
            className="kospi-map-nav-link kospi-map-nav-link--globaltop100"
          >
            <GlobeRankIcon /> 글로벌 시총
          </Link>
          <Link
            to="/fight"
            className="kospi-map-nav-link kospi-map-nav-link--battle"
          >
            <BattleIcon /> 시총대결
          </Link>
          <Link
            to="/news"
            className="kospi-map-nav-link kospi-map-nav-link--news"
          >
            <GlobalNewsIcon /> NEWS
          </Link>
        </div>
      </header>
      <main className="etf-main">
        <section className="etf-hero">
          <div className="etf-hero-copy">
            <span className="etf-eyebrow">ETF MARKET INTELLIGENCE</span>
            <h1>
              자금의 궤도를
              <br />
              <em>발견하는 마켓</em>
            </h1>
            <p>
              거래대금, 모멘텀, 52주 위치와 실시간 토론을 하나의 레이더에서
              탐색하세요.
            </p>
          </div>
          <div className="etf-orbit" aria-hidden="true">
            <i />
            <i />
            <i />
            <span>
              ETF<b>{region}</b>
            </span>
          </div>
          <div className="etf-live">
            <i /> LIVE · 10초 갱신
            <strong>
              {updatedAt
                ? new Date(updatedAt).toLocaleTimeString("ko-KR")
                : "—"}
            </strong>
          </div>
        </section>
        <section className="etf-pulse">
          <div>
            <span>거래량 1위</span>
            <strong>{leaders[0]?.name ?? "—"}</strong>
            <b>{leaders[0] ? compact(leaders[0].volume) : "—"}</b>
          </div>
          <div>
            <span>상승 선두</span>
            <strong>
              {items.slice().sort((a, b) => b.change_pct - a.change_pct)[0]
                ?.name ?? "—"}
            </strong>
            <b className="up">
              {pct(
                items.slice().sort((a, b) => b.change_pct - a.change_pct)[0]
                  ?.change_pct,
              )}
            </b>
          </div>
          <div>
            <span>조회 종목</span>
            <strong>{items.length} ETFs</strong>
            <b>{region === "KR" ? "한국 거래소" : "미국 시장"}</b>
          </div>
        </section>
        <section className="etf-market-radar" aria-label="ETF 시장 흐름 요약">
          <div className="etf-breadth">
            <span>MARKET BREADTH</span>
            <strong>
              {advancers}
              <small> 상승</small> <i>/</i> {decliners}
              <small> 하락</small>
            </strong>
            <div>
              <i style={{ width: `${breadth}%` }} />
            </div>
            <p>
              총 거래대금{" "}
              <b>
                {compact(totalTurnover)} {items[0]?.currency ?? ""}
              </b>
            </p>
          </div>
          <div className="etf-radar-track">
            {radarItems.map((item, index) => (
              <button
                key={item.code}
                type="button"
                data-tone={tone(item.change_pct)}
                onClick={() => setQuery(item.name)}
                style={
                  {
                    "--signal": `${Math.min(100, 28 + Math.abs(item.change_pct) * 11)}%`,
                    "--delay": `${index * 0.06}s`,
                  } as CSSProperties
                }
              >
                <span>{item.code}</span>
                <strong>{item.name}</strong>
                <b>{pct(item.change_pct)}</b>
                <i />
              </button>
            ))}
          </div>
        </section>
        <div className="etf-tabs" role="tablist">
          <button
            className={region === "KR" ? "active" : ""}
            onClick={() => {
              setRegion("KR");
              setCategory("전체");
              setQuery("");
            }}
          >
            국내 ETF{" "}
            <span className="etf-tab-symbol">
              <KoreaFlag />
            </span>
          </button>
          <button
            className={region === "US" ? "active" : ""}
            onClick={() => {
              setRegion("US");
              setCategory("전체");
              setQuery("");
            }}
          >
            해외 ETF{" "}
            <span className="etf-tab-symbol">
              <GlobalGlobe />
            </span>
          </button>
        </div>
        <section className="etf-tools">
          <div className="etf-search">
            <span>⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ETF명, 종목코드, 추종지수 검색"
              aria-label="ETF 검색"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="검색어 지우기">
                ×
              </button>
            )}
            {suggestions.length > 0 && (
              <div className="etf-suggestions">
                {suggestions.map((item) => (
                  <button key={item.code} onClick={() => setQuery(item.name)}>
                    <b>{item.name}</b>
                    <span>
                      {item.code} · {item.benchmark}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <label>
            정렬
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="turnover">거래대금 높은순</option>
              <option value="volume">거래량 높은순</option>
              <option value="change">오늘 등락률</option>
              <option value="d20">20일 수익률</option>
              <option value="d60">60일 수익률</option>
              <option value="d120">120일 수익률</option>
              <option value="name">이름순</option>
            </select>
          </label>
        </section>
        <div className="etf-section-heading">
          <div>
            <span>ETF SIGNAL DECK</span>
            <h2>시장을 움직이는 ETF</h2>
          </div>
          <div className="etf-section-heading-right">
            <div className="etf-view-toggle" role="tablist" aria-label="ETF 목록 보기 방식">
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "card"}
                className={viewMode === "card" ? "active" : ""}
                onClick={() => setViewMode("card")}
              >
                <CardViewIcon /> 카드형
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "table"}
                className={viewMode === "table" ? "active" : ""}
                onClick={() => setViewMode("table")}
              >
                <TableViewIcon /> 표로 보기
              </button>
            </div>
            <strong>
              {visible.length}
              <small>개 신호</small>
            </strong>
          </div>
        </div>
        <div className="etf-categories">
          {categories.map((value) => (
            <button
              key={value}
              className={category === value ? "active" : ""}
              onClick={() => setCategory(value)}
            >
              {value}
            </button>
          ))}
        </div>
        {error && <div className="error-state">{error}</div>}
        {loading && items.length === 0 ? (
          <div className="etf-loading">ETF 데이터를 불러오는 중입니다…</div>
        ) : viewMode === "card" ? (
          <section className="etf-grid">
            {visible.map((item, index) => (
              <EtfCard
                key={item.code}
                item={item}
                rank={index + 1}
                discussions={
                  (item.region === "KR"
                    ? discussions[item.code]?.map((post) => ({
                        id: post.nid,
                        title: post.title,
                      }))
                    : globalDiscussions[item.code]?.map((post) => ({
                        id: post.id,
                        title: post.title || post.text,
                      }))) ?? []
                }
                onBoard={openBoard}
              />
            ))}
          </section>
        ) : (
          <EtfTable
            items={visible}
            discussions={discussions}
            globalDiscussions={globalDiscussions}
            sort={sort}
            setSort={setSort}
            onBoard={openBoard}
          />
        )}
        {!loading && visible.length === 0 && (
          <div className="etf-empty">검색 조건에 맞는 ETF가 없습니다.</div>
        )}
        <p className="etf-disclaimer">
          시세는 정보 제공처의 지연 및 거래 세션에 따라 실제 체결가와 차이가 날
          수 있습니다. 레버리지·인버스 ETF는 일간 수익률 추종 상품으로 장기
          성과가 기초지수 배수와 다를 수 있습니다.
        </p>
      </main>
      <Footer />
      {boardItem && (
        <div
          className="etf-board-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setBoardItem(null);
          }}
        >
          <section
            className="etf-board-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${boardItem.name} 종목 토론방`}
          >
            <header>
              <div>
                <span>
                  {boardItem.region === "KR"
                    ? "네이버 종목 토론방"
                    : "토스증권 커뮤니티"}
                </span>
                <h2>{boardItem.name}</h2>
              </div>
              <button onClick={() => setBoardItem(null)} aria-label="닫기">
                ×
              </button>
            </header>
            {boardItem.region === "KR" ? (
              <BoardPanel
                key={`${boardItem.code}-${boardNid ?? "list"}`}
                code={boardItem.code}
                name={boardItem.name}
                initialNid={boardNid}
              />
            ) : (
              <GlobalBoardPanel
                key={`${boardItem.code}-${boardNid ?? "list"}`}
                code={boardItem.code}
                name={boardItem.name}
                initialPostId={boardNid}
                source="toss"
                sourceUrl={`https://www.tossinvest.com/stocks/${boardItem.code}/community`}
              />
            )}
            {boardItem.region === "KR" && (
              <a
                className="etf-board-naver"
                href={`https://finance.naver.com/item/board.naver?code=${boardItem.code}`}
                target="_blank"
                rel="noreferrer"
              >
                네이버에서 전체 게시판 보기 ↗
              </a>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
