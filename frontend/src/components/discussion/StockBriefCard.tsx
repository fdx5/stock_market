import { useEffect, useMemo, useRef, useState } from "react";
import { EtfItem, InvestorTrendRecord, MarketSparkline, StockSearchResult, api } from "../../api/client";
import { eok } from "../../desk2/lib";
import { startVisibilityAwareInterval } from "../../pollVisibility";
import { Link } from "../../router";
import { isBeforeKrPreMarket } from "../../spotlight";
import { reportDiscussionSearchSelection } from "../../useActivityTracking";
import OrderBookBalance from "../OrderBookBalance";
import StockLogo from "../StockLogo";
import {
  AssetKind,
  AssetQuoteSnapshot,
  AssetTarget,
  MarketKind,
  QUICK_ASSET_PRESETS,
  assetBadgeLabel,
} from "./types";

const AI_BRIEF_SLUGS: Record<string, string> = {
  "005930": "samsung",
  "000660": "hynix",
  "005380": "hyundai",
  "402340": "sksquare",
  "009150": "semco",
};

type StockBrief = { date: string; summary: string; analysis: string[]; key_issues?: string[] };

function todayKst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function toneOf(value: number | null | undefined): "up" | "down" | "flat" {
  if (!value) return "flat";
  return value > 0 ? "up" : value < 0 ? "down" : "flat";
}

function fmtPct(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function fmtPrice(value: number, market: MarketKind): string {
  if (market === "US") {
    return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function fmtDelta(value: number, market: MarketKind): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (market === "US") {
    return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${sign}${Math.round(abs).toLocaleString("ko-KR")}`;
}

function fmtMarcap(marcap: number | null | undefined, market: MarketKind): string | null {
  if (!marcap || !Number.isFinite(marcap) || marcap <= 0) return null;
  if (market === "KR") {
    const eokVal = marcap / 1e8;
    if (eokVal >= 10000) return `${(eokVal / 10000).toFixed(1)}조원`;
    return `${Math.round(eokVal).toLocaleString("ko-KR")}억원`;
  }
  if (marcap >= 1e12) return `$${(marcap / 1e12).toFixed(2)}T`;
  if (marcap >= 1e9) return `$${(marcap / 1e9).toFixed(1)}B`;
  return `$${(marcap / 1e6).toFixed(0)}M`;
}

function CompactSparkline({ points, tone }: { points: number[]; tone: "up" | "down" | "flat" }) {
  if (points.length < 2) return <div className="dr-spark-empty" aria-hidden="true" />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const W = 156;
  const H = 38;
  const coords = points.map((value, idx) => [
    (idx / (points.length - 1)) * (W - 6) + 3,
    H - 4 - ((value - min) / span) * (H - 10),
  ]);
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];
  const area = `3,${H - 2} ${line} ${W - 3},${H - 2}`;
  return (
    <svg className={`dr-spark is-${tone}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={area} className="dr-spark-fill" />
      <polyline points={line} className="dr-spark-line" />
      <circle cx={last[0]} cy={last[1]} r="2.8" className="dr-spark-dot" />
    </svg>
  );
}

function buildRuleSummary(
  quote: AssetQuoteSnapshot | null,
  spark: MarketSparkline | null,
  changeTone: "up" | "down" | "flat",
  investorRecords: InvestorTrendRecord[] | null,
  beforePreMarket: boolean,
): string[] {
  const lines: string[] = [];
  const d20 = spark?.returns?.d20 ?? quote?.returns_d20;

  if (quote) {
    lines.push(
      beforePreMarket
        ? `전일 장에서 ${fmtPct(quote.change_pct)} ${changeTone === "up" ? "상승 마감" : changeTone === "down" ? "하락 마감" : "보합 마감"}했습니다.`
        : `현재 ${fmtPct(quote.change_pct)} ${changeTone === "up" ? "강세 흐름" : changeTone === "down" ? "약세 흐름" : "보합권 흐름"}을 보이고 있습니다.`,
    );
  }
  if (d20 != null) {
    lines.push(`최근 20거래일 수익률은 ${fmtPct(d20, 1)}로 ${d20 >= 0 ? "단기 우상향" : "단기 조정"} 구간입니다.`);
  }
  const pts = spark?.points ?? quote?.sparkline ?? [];
  if (quote && pts.length >= 2) {
    const hi = Math.max(...pts);
    const lo = Math.min(...pts);
    if (hi > lo) {
      const pos = Math.round(((quote.close - lo) / (hi - lo)) * 100);
      lines.push(`조회 구간 고점 대비 ${fmtPct(((quote.close - hi) / hi) * 100, 1)}, 저점 대비 ${fmtPct(((quote.close - lo) / lo) * 100, 1)} (구간 내 ${pos}% 위치)입니다.`);
    }
  }
  if (investorRecords && investorRecords.length > 0) {
    const latest = investorRecords[0];
    const cumForeign = investorRecords.reduce((sum, row) => sum + row.foreign_amount, 0);
    const cumInst = investorRecords.reduce((sum, row) => sum + row.institution_amount, 0);
    lines.push(
      `최근 수급(${latest.date}): 외국인 ${eok(latest.foreign_amount, "ko")}, 기관 ${eok(latest.institution_amount, "ko")} · ${investorRecords.length}일 누적 외국인 ${eok(cumForeign, "ko")}, 기관 ${eok(cumInst, "ko")}.`,
    );
  }
  return lines;
}

export default function StockBriefCard({
  asset,
  quote,
  sourceLabel,
  postCount,
  refreshing,
  onRefresh,
  onSelectAsset,
}: {
  asset: AssetTarget;
  quote: AssetQuoteSnapshot | null;
  sourceLabel: string;
  postCount: number;
  refreshing: boolean;
  onRefresh: () => void;
  onSelectAsset: (next: AssetTarget) => void;
}) {
  const { code, name, market, kind } = asset;
  const [brief, setBrief] = useState<StockBrief | null>(null);
  const [spark, setSpark] = useState<MarketSparkline | null>(null);
  const [investorRecords, setInvestorRecords] = useState<InvestorTrendRecord[]>([]);
  const [briefExpanded, setBriefExpanded] = useState(false);

  // Integrated instant asset search (KR stocks, US stocks, KR ETFs, US ETFs)
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [stockResults, setStockResults] = useState<StockSearchResult[]>([]);
  const [etfUniverse, setEtfUniverse] = useState<EtfItem[]>([]);
  const etfRequested = useRef(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const investorApplicable = market === "KR" && kind === "STOCK";
  const detailPath = kind === "ETF"
    ? (market === "US" ? "/etf/us" : "/etf/kr")
    : `/stock/${encodeURIComponent(code)}`;

  // Close search dropdown on outside click
  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  // Load AI brief if available for today
  useEffect(() => {
    setBrief(null);
    const slug = market === "KR" && kind === "STOCK" ? AI_BRIEF_SLUGS[code] : undefined;
    if (!slug) return;
    let cancelled = false;
    const load = () => {
      fetch(`/api/market-brief/latest/${slug}`)
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((data: StockBrief) => {
          if (!cancelled && data.date === todayKst()) setBrief(data);
        })
        .catch(() => {});
    };
    load();
    const stop = startVisibilityAwareInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [code, kind, market]);

  // Load sparkline trend
  useEffect(() => {
    setSpark(null);
    let cancelled = false;
    api
      .marketSparklines([code], market === "US" ? "us" : "kr")
      .then((res) => {
        if (!cancelled) setSpark(res.items[code] ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code, market]);

  // Load KR stock investor flow
  useEffect(() => {
    setInvestorRecords([]);
    if (!investorApplicable) return;
    let cancelled = false;
    const load = () => {
      api
        .investorTrend(code, 20)
        .then((res) => {
          if (!cancelled) setInvestorRecords(res.records);
        })
        .catch(() => {});
    };
    load();
    const stop = startVisibilityAwareInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [code, investorApplicable]);

  // Live stock + ETF search
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setStockResults([]);
      setSearching(false);
      return;
    }
    if (!etfRequested.current) {
      etfRequested.current = true;
      Promise.all([api.etfs("KR"), api.etfs("US")])
        .then(([kr, us]) => setEtfUniverse([...kr.items, ...us.items]))
        .catch(() => setEtfUniverse([]));
    }
    setSearching(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api
        .search(trimmed, controller.signal)
        .then(setStockResults)
        .catch((err: Error) => {
          if (err.name !== "AbortError") setStockResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  const searchResults = useMemo<AssetTarget[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const etfs: AssetTarget[] = etfUniverse
      .filter((item) => `${item.name} ${item.code} ${item.benchmark}`.toLowerCase().includes(q))
      .map((item) => ({ code: item.code, name: item.name, market: item.region, kind: "ETF" }));
    const stocks: AssetTarget[] = stockResults.map((item) => ({
      code: item.code,
      name: item.name,
      market: item.market === "US" ? "US" : "KR",
      kind: "STOCK",
    }));
    const map = new Map<string, AssetTarget>();
    for (const item of [...etfs, ...stocks]) {
      const key = `${item.kind}:${item.market}:${item.code}`;
      if (!map.has(key)) map.set(key, item);
    }
    return Array.from(map.values()).slice(0, 12);
  }, [etfUniverse, searchQuery, stockResults]);

  const changeTone = toneOf(quote?.change_pct);
  const sparkPoints = spark?.points?.length ? spark.points : (quote?.sparkline ?? []);
  const d20 = spark?.returns?.d20 ?? quote?.returns_d20 ?? null;
  const trendTone = d20 != null ? toneOf(d20) : changeTone;
  const latestFlow = investorRecords[0] ?? null;
  const beforePreMarket = market === "KR" && isBeforeKrPreMarket();
  const summaryLines = useMemo(
    () => buildRuleSummary(quote, spark, changeTone, investorApplicable ? investorRecords : null, beforePreMarket),
    [quote, spark, changeTone, investorApplicable, investorRecords, beforePreMarket],
  );
  const marcapLabel = fmtMarcap(quote?.marcap, market);

  // 1-year range position
  const rangePos = useMemo(() => {
    if (!quote) return null;
    const hi = quote.week52_high ?? (sparkPoints.length >= 2 ? Math.max(...sparkPoints) : null);
    const lo = quote.week52_low ?? (sparkPoints.length >= 2 ? Math.min(...sparkPoints) : null);
    if (hi == null || lo == null || hi <= lo) return null;
    const pct = Math.max(0, Math.min(100, ((quote.close - lo) / (hi - lo)) * 100));
    return { hi, lo, pct };
  }, [quote, sparkPoints]);

  const chooseAsset = (next: AssetTarget) => {
    reportDiscussionSearchSelection({
      code: next.code,
      name: next.name,
      market: next.market,
      assetKind: next.kind,
    });
    setSearchQuery("");
    setSearchOpen(false);
    searchInputRef.current?.blur();
    onSelectAsset(next);
  };

  return (
    <section className="dr-brief" aria-label="종목 간략 정보 및 검색">
      {/* Row 1: Identity + Live Quote + Integrated Asset Switcher Search */}
      <div className="dr-brief-top">
        <div className="dr-identity">
          <Link to={detailPath} className="dr-logo-link" title={`${name} 상세 페이지로 이동`}>
            <StockLogo
              code={code}
              name={name}
              className="dr-logo"
              assetType={kind === "ETF" ? "etf" : "stock"}
            />
          </Link>
          <div className="dr-identity-meta">
            <div className="dr-identity-badges">
              <span className={`dr-asset-badge is-${market.toLowerCase()} is-${kind.toLowerCase()}`}>
                {assetBadgeLabel(market, kind)}
              </span>
              <span className="dr-code">{code}</span>
              {quote?.session && quote.session !== "regular" && (
                <span className="dr-session-pill">
                  {quote.session === "pre" ? "프리마켓" : "애프터마켓"}
                </span>
              )}
              {sourceLabel && <span className="dr-source-tag">{sourceLabel}</span>}
            </div>
            <div className="dr-title-row">
              <h1>{name}</h1>
              {quote ? (
                <div className={`dr-price-inline is-${changeTone}`}>
                  <strong>{fmtPrice(quote.close, market)}</strong>
                  <span>
                    {fmtDelta(quote.change, market)} ({fmtPct(quote.change_pct)})
                  </span>
                </div>
              ) : (
                <span className="dr-price-loading">시세 불러오는 중…</span>
              )}
            </div>
          </div>
        </div>

        <div className="dr-brief-actions">
          <div className="dr-search" ref={searchBoxRef}>
            <span className="dr-search-icon" aria-hidden="true">⌕</span>
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="다른 종목·ETF·해외주식 검색 (예: SK하이닉스, NVDA, QQQ)"
              aria-label="국내·해외 주식 및 ETF 종목토론 검색"
            />
            {searching && <i className="dr-spinner" aria-label="검색 중" />}
            {searchQuery && (
              <button
                type="button"
                className="dr-search-clear"
                onClick={() => {
                  setSearchQuery("");
                  setSearchOpen(false);
                }}
                aria-label="검색어 지우기"
              >
                ×
              </button>
            )}

            {searchOpen && searchQuery.trim() && (
              <div className="dr-search-dropdown" role="listbox" aria-label="종목 검색 결과">
                {searchResults.length === 0 && !searching ? (
                  <p className="dr-search-empty">일치하는 종목이나 ETF가 없습니다.</p>
                ) : (
                  searchResults.map((item) => (
                    <button
                      type="button"
                      key={`${item.kind}-${item.market}-${item.code}`}
                      className="dr-search-item"
                      onClick={() => chooseAsset(item)}
                    >
                      <StockLogo
                        code={item.code}
                        name={item.name}
                        className="dr-search-item-logo"
                        assetType={item.kind === "ETF" ? "etf" : "stock"}
                      />
                      <span className="dr-search-item-name">
                        <strong>{item.name}</strong>
                        <small>{item.code}</small>
                      </span>
                      <span className={`dr-asset-badge is-${item.market.toLowerCase()} is-${item.kind.toLowerCase()}`}>
                        {assetBadgeLabel(item.market, item.kind)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="dr-header-btns">
            <button
              type="button"
              className="dr-btn dr-btn--ghost"
              onClick={onRefresh}
              disabled={refreshing}
              title="최신 토론 새로고침"
            >
              <span className={refreshing ? "is-spinning" : ""} aria-hidden="true">↻</span>
              <span>새 글</span>
            </button>
            <Link to={detailPath} className="dr-btn dr-btn--accent">
              차트·상세 ↗
            </Link>
          </div>
        </div>
      </div>

      {/* Row 2: Compact Stock Snapshot Metrics (Sparkline + Key Numbers + Orderbook + Brief toggle) */}
      <div className="dr-snapshot-strip">
        <div className="dr-snap-chart">
          <CompactSparkline points={sparkPoints} tone={trendTone} />
          <div className="dr-snap-chart-meta">
            <span>20일 추세</span>
            <strong className={`is-${trendTone}`}>{fmtPct(d20, 1)}</strong>
          </div>
        </div>

        <div className="dr-snap-metrics">
          {marcapLabel && (
            <div className="dr-metric">
              <span>시가총액</span>
              <b>{marcapLabel}</b>
            </div>
          )}
          {quote?.benchmark && (
            <div className="dr-metric">
              <span>추종 지수</span>
              <b title={quote.benchmark}>{quote.benchmark}</b>
            </div>
          )}
          {rangePos && (
            <div className="dr-metric dr-metric--range">
              <span>
                연간 위치 <em>{Math.round(rangePos.pct)}%</em>
              </span>
              <div className="dr-range-bar" aria-label={`1년 가격 구간 중 ${Math.round(rangePos.pct)}% 위치`}>
                <i style={{ left: `${rangePos.pct}%` }} />
              </div>
            </div>
          )}
          {latestFlow && (
            <div className="dr-metric dr-metric--flow">
              <span>최근 수급 ({latestFlow.date.slice(5)})</span>
              <b>
                <em className={`is-${toneOf(latestFlow.foreign_amount)}`}>외 {eok(latestFlow.foreign_amount, "ko")}</em>
                {" · "}
                <em className={`is-${toneOf(latestFlow.institution_amount)}`}>기 {eok(latestFlow.institution_amount, "ko")}</em>
              </b>
            </div>
          )}
          {investorApplicable && (
            <div className="dr-metric dr-metric--orderbook">
              <OrderBookBalance code={code} />
            </div>
          )}
          <div className="dr-metric dr-metric--posts">
            <span>로드된 토론</span>
            <b>{postCount.toLocaleString()}건</b>
          </div>
        </div>

        <button
          type="button"
          className={`dr-brief-toggle ${briefExpanded ? "is-open" : ""}`}
          onClick={() => setBriefExpanded((prev) => !prev)}
          aria-expanded={briefExpanded}
        >
          <span>{brief ? "AI 브리핑" : "종목 요약"}</span>
          <i aria-hidden="true">{briefExpanded ? "▴" : "▾"}</i>
        </button>
      </div>

      {/* Expandable Stock Brief / Auto Summary */}
      {briefExpanded && (
        <div className="dr-brief-drawer">
          <div className="dr-brief-drawer-head">
            <strong>{brief ? `오늘의 AI 종목 브리핑 (${brief.date})` : `${name} 핵심 흐름 요약`}</strong>
            <span>시세·추세·수급 데이터 기반</span>
          </div>
          {brief ? (
            <div className="dr-brief-drawer-body">
              <p className="dr-brief-lead">{brief.summary}</p>
              {brief.analysis.slice(0, 3).map((line, i) => (
                <p key={i}>{line}</p>
              ))}
              {brief.key_issues && brief.key_issues.length > 0 && (
                <ul className="dr-brief-issues">
                  {brief.key_issues.slice(0, 4).map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="dr-brief-drawer-body">
              {summaryLines.length > 0 ? (
                summaryLines.map((line, i) => <p key={i}>{line}</p>)
              ) : (
                <p>시세 및 추세 데이터를 불러오고 있습니다.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Row 3: Quick-Switch Popular Stocks / ETFs / US Stocks */}
      <div className="dr-quick-bar" role="navigation" aria-label="인기 종목토론 빠른 이동">
        <span className="dr-quick-label">빠른 전환</span>
        <div className="dr-quick-chips">
          {QUICK_ASSET_PRESETS.map((preset) => {
            const active =
              preset.code.toUpperCase() === code.toUpperCase() &&
              preset.market === market &&
              preset.kind === kind;
            return (
              <button
                key={`${preset.kind}:${preset.market}:${preset.code}`}
                type="button"
                className={`dr-quick-chip ${active ? "is-active" : ""}`}
                onClick={() => chooseAsset(preset)}
                aria-current={active ? "true" : undefined}
              >
                <span className={`dr-quick-dot is-${preset.group.toLowerCase()}`} aria-hidden="true" />
                <span>{preset.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
