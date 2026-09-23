import { ReactNode, useEffect, useMemo, useState } from "react";
import { InvestorSummaryItem, MarketMapItem, MarketReturns, WeeklyForeignItem, api } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link } from "../router";
import StockLogo from "../components/StockLogo";
import { Marker, Skel } from "./parts";
import { eok, krwPrice, openStock, pct, shares, toneOf, turnoverOf, useL, won } from "./lib";

/* 05 수급 표.
 *
 * The classic flow board's five tables — the two top-50s, per-stock investor
 * flows, and the weekly foreign buy and sell lists — with one thing the classic
 * board could not do: every column sorts. A reader looking at the top 50 by cap
 * who wants to know which of them had the worst quarter no longer has to scan
 * fifty rows for the reddest 60-day figure. */

type Tab = "kospi" | "kosdaq" | "investor" | "fbuy" | "fsell";

interface Column<T> {
  key: string;
  label: string;
  sort?: (row: T) => number | string | null;
  cell: (row: T, index: number) => ReactNode;
  className?: string;
}

function SortTable<T>({ rows, columns, loading, rowKey, initial }: { rows: T[]; columns: Column<T>[]; loading: boolean; rowKey: (row: T) => string; initial?: string }) {
  const L = useL();
  const [sortKey, setSortKey] = useState<string | null>(initial ?? null);
  const [dir, setDir] = useState<1 | -1>(-1);
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sort) return rows;
    const get = col.sort;
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      if (typeof x === "string" && typeof y === "string") return x.localeCompare(y, "ko") * dir;
      return ((x as number) - (y as number)) * dir;
    });
  }, [rows, columns, sortKey, dir]);

  const toggle = (key: string) => {
    if (sortKey === key) {
      if (dir === -1) setDir(1);
      else {
        // Third click returns to the source order.
        setSortKey(null);
        setDir(-1);
      }
    } else {
      setSortKey(key);
      setDir(-1);
    }
  };

  return (
    <div className="d2-table-wrap" tabIndex={0} role="region" aria-label={L("표 — 가로로 스크롤할 수 있습니다", "Table — scrolls horizontally")}>
      <table className="d2-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.className} aria-sort={sortKey === c.key ? (dir === 1 ? "ascending" : "descending") : undefined}>
                {c.sort ? (
                  <button type="button" onClick={() => toggle(c.key)} className={sortKey === c.key ? "is-sorted" : ""}>
                    {c.label}
                    <i aria-hidden="true">{sortKey === c.key ? (dir === 1 ? "↑" : "↓") : "↕"}</i>
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 10 }, (_, i) => (
                <tr key={`s${i}`} aria-hidden="true">
                  <td colSpan={columns.length}>
                    <Skel h={14} />
                  </td>
                </tr>
              ))
            : sorted.map((row, i) => (
                <tr key={rowKey(row)}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.className}>
                      {c.cell(row, i)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

function Ret({ v }: { v: number | null | undefined }) {
  return <span className={`d2-num is-${toneOf(v)}`}>{pct(v)}</span>;
}

function useReturns(codes: string[]): Record<string, MarketReturns> {
  const [returns, setReturns] = useState<Record<string, MarketReturns>>({});
  const key = codes.join(",");
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    api
      .marketReturns(key.split(","))
      .then((res) => {
        if (!cancelled) setReturns((prev) => ({ ...prev, ...res.items }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key]);
  return returns;
}

function Top50({ market }: { market: "KOSPI" | "KOSDAQ" }) {
  const { lang } = useLanguage();
  const L = useL();
  const [items, setItems] = useState<MarketMapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const fetcher = market === "KOSPI" ? () => api.marketMap(50) : () => api.kosdaqMap(50);
    const load = (first: boolean) =>
      fetcher()
        .then((res) => {
          if (cancelled) return;
          setItems(res.items);
          setError(null);
        })
        .catch((e: Error) => {
          if (!cancelled && first) setError(e.message || L("데이터를 불러오지 못했습니다.", "Could not load data."));
        })
        .finally(() => {
          if (!cancelled && first) setLoading(false);
        });
    load(true);
    const stop = startVisibilityAwareInterval(() => load(false), 10_000);
    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market]);
  const returns = useReturns(items.map((i) => i.code));
  const names = useTranslatedTexts(items.map((i) => i.name));
  const nameOf = new Map(items.map((it, i) => [it.code, names[i] ?? it.name]));
  if (error) return <p className="d2-empty">{error}</p>;
  const columns: Column<MarketMapItem>[] = [
    { key: "rank", label: "#", className: "is-rank", sort: (r) => -items.indexOf(r), cell: (r) => items.indexOf(r) + 1 },
    {
      key: "name",
      label: L("종목", "Name"),
      className: "is-name",
      sort: (r) => r.name,
      cell: (r) => (
        <button type="button" onClick={() => openStock({ code: r.code, name: r.name, market })}>
          <StockLogo code={r.code} name={r.name} className="d2-table-logo" />
          {nameOf.get(r.code)}
        </button>
      ),
    },
    { key: "close", label: L("현재가", "Price"), sort: (r) => r.close, cell: (r) => krwPrice(r.close, lang) },
    { key: "chg", label: L("등락률", "Change"), sort: (r) => r.change_pct, cell: (r) => <Ret v={r.change_pct} /> },
    { key: "d20", label: L("20일", "20D"), sort: (r) => returns[r.code]?.d20 ?? null, cell: (r) => <Ret v={returns[r.code]?.d20} /> },
    { key: "d60", label: L("60일", "60D"), sort: (r) => returns[r.code]?.d60 ?? null, cell: (r) => <Ret v={returns[r.code]?.d60} /> },
    { key: "d120", label: L("120일", "120D"), sort: (r) => returns[r.code]?.d120 ?? null, cell: (r) => <Ret v={returns[r.code]?.d120} /> },
    { key: "vol", label: L("거래량", "Volume"), sort: (r) => r.volume ?? 0, cell: (r) => shares(r.volume ?? 0, lang) },
    { key: "amt", label: L("거래대금", "Turnover"), sort: (r) => turnoverOf(r), cell: (r) => won(turnoverOf(r), lang) },
  ];
  return <SortTable rows={items} columns={columns} loading={loading} rowKey={(r) => r.code} />;
}

function Amount({ v }: { v: number }) {
  const { lang } = useLanguage();
  return <span className={`d2-num is-${toneOf(v)}`}>{eok(v, lang)}</span>;
}

function InvestorTable({ items, loading, error }: { items: InvestorSummaryItem[]; loading: boolean; error: string | null }) {
  const L = useL();
  const names = useTranslatedTexts(items.map((i) => i.name));
  if (error) return <p className="d2-empty">{error}</p>;
  const columns: Column<InvestorSummaryItem>[] = [
    {
      key: "name",
      label: L("종목", "Name"),
      className: "is-name",
      sort: (r) => r.name,
      cell: (r) => (
        <Link to={`/investor/${r.code}`}>
          <StockLogo code={r.code} name={r.name} className="d2-table-logo" />
          {names[items.indexOf(r)] ?? r.name}
        </Link>
      ),
    },
    { key: "ind", label: L("개인", "Individuals"), sort: (r) => r.individual_amount, cell: (r) => <Amount v={r.individual_amount} /> },
    { key: "inst", label: L("기관", "Institutions"), sort: (r) => r.institution_amount, cell: (r) => <Amount v={r.institution_amount} /> },
    { key: "for", label: L("외국인", "Foreigners"), sort: (r) => r.foreign_amount, cell: (r) => <Amount v={r.foreign_amount} /> },
  ];
  return <SortTable rows={items} columns={columns} loading={loading} rowKey={(r) => r.code} />;
}

function WeeklyTable({ items, loading, error, side }: { items: WeeklyForeignItem[]; loading: boolean; error: string | null; side: "buy" | "sell" }) {
  const { lang } = useLanguage();
  const L = useL();
  const names = useTranslatedTexts(items.map((i) => i.name));
  if (error) return <p className="d2-empty">{error}</p>;
  const columns: Column<WeeklyForeignItem>[] = [
    { key: "rank", label: "#", className: "is-rank", sort: (r) => -items.indexOf(r), cell: (r) => items.indexOf(r) + 1 },
    {
      key: "name",
      label: L("종목", "Name"),
      className: "is-name",
      sort: (r) => r.name,
      cell: (r) => (
        <Link to={`/investor/${r.code}`}>
          <StockLogo code={r.code} name={r.name} className="d2-table-logo" />
          {names[items.indexOf(r)] ?? r.name}
        </Link>
      ),
    },
    { key: "amt", label: side === "buy" ? L("외국인 순매수", "Foreign net buy") : L("외국인 순매도", "Foreign net sell"), sort: (r) => r.amount, cell: (r) => <Amount v={r.amount} /> },
    { key: "close", label: L("현재가", "Price"), sort: (r) => r.close, cell: (r) => krwPrice(r.close, lang) },
    { key: "wk", label: L("주간 등락", "Week"), sort: (r) => r.weekly_change_pct, cell: (r) => <Ret v={r.weekly_change_pct} /> },
    {
      key: "days",
      label: side === "buy" ? L("매수일", "Buy days") : L("매도일", "Sell days"),
      sort: (r) => (side === "buy" ? r.foreign_buy_days : r.foreign_sell_days),
      cell: (r) => <Days n={side === "buy" ? r.foreign_buy_days : r.foreign_sell_days} tone={side === "buy" ? "up" : "down"} />,
    },
    { key: "inst", label: L("기관 주간", "Inst. week"), sort: (r) => r.institution_amount, cell: (r) => <Amount v={r.institution_amount} /> },
    { key: "ind", label: L("개인 주간", "Indiv. week"), sort: (r) => r.individual_amount, cell: (r) => <Amount v={r.individual_amount} /> },
  ];
  return <SortTable rows={items} columns={columns} loading={loading} rowKey={(r) => r.code} />;
}

/** Five pips, one per session of the week, filled for each day foreigners were
 * on this side — "4일" read as a shape rather than a number. */
function Days({ n, tone }: { n: number; tone: "up" | "down" }) {
  return (
    <span className={`d2-days is-${tone}`} aria-label={`${n}`}>
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} className={i < n ? "is-on" : ""} />
      ))}
      <b>{n}</b>
    </span>
  );
}

export default function FlowDesk() {
  const L = useL();
  const [tab, setTab] = useState<Tab>("kospi");
  const [investor, setInvestor] = useState<InvestorSummaryItem[]>([]);
  const [investorLoading, setInvestorLoading] = useState(true);
  const [investorError, setInvestorError] = useState<string | null>(null);
  const [weekly, setWeekly] = useState<{ buy: WeeklyForeignItem[]; sell: WeeklyForeignItem[] }>({ buy: [], sell: [] });
  const [weeklyLoading, setWeeklyLoading] = useState(true);
  const [weeklyError, setWeeklyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadInvestor = (first: boolean) =>
      api
        .investorSummary()
        .then((res) => {
          if (cancelled) return;
          setInvestor(res.items);
          setInvestorError(null);
        })
        .catch((e: Error) => {
          if (!cancelled && first) setInvestorError(e.message);
        })
        .finally(() => {
          if (!cancelled && first) setInvestorLoading(false);
        });
    const loadWeekly = (first: boolean) =>
      api
        .weeklyForeignTop()
        .then((res) => {
          if (cancelled) return;
          setWeekly(res);
          setWeeklyError(null);
        })
        .catch((e: Error) => {
          if (!cancelled && first) setWeeklyError(e.message);
        })
        .finally(() => {
          if (!cancelled && first) setWeeklyLoading(false);
        });
    loadInvestor(true);
    loadWeekly(true);
    const a = startVisibilityAwareInterval(() => loadInvestor(false), 5 * 60_000);
    const b = startVisibilityAwareInterval(() => loadWeekly(false), 5 * 60_000);
    return () => {
      cancelled = true;
      a();
      b();
    };
  }, []);

  const latest = investor[0]?.date;
  const notes: Record<Tab, string> = {
    kospi: L("시가총액 상위 50종목 · 10초마다 갱신 · 열 제목을 누르면 정렬됩니다.", "Top 50 by market cap · refreshed every 10s · click a column to sort."),
    kosdaq: L("시가총액 상위 50종목 · 10초마다 갱신 · 열 제목을 누르면 정렬됩니다.", "Top 50 by market cap · refreshed every 10s · click a column to sort."),
    investor: latest
      ? L(`${latest} 기준 누적 순매수(억원) · 시총 100위까지 · 종목을 누르면 최근 추이로 이동합니다.`, `Net buying as of ${latest} (KRW 100M) · top 100 by cap · click a name for its trend.`)
      : L("최근 확정 거래일 기준 누적 순매수(억원) · 시총 100위까지.", "Net buying on the latest settled session (KRW 100M) · top 100 by cap."),
    fbuy: L("최근 5거래일 외국인 누적 순매수 상위 20종목 · 점 5개는 한 주의 거래일입니다.", "Top 20 by foreign net buying over the last 5 sessions · the five pips are the week's sessions."),
    fsell: L("최근 5거래일 외국인 누적 순매도 상위 20종목 · 점 5개는 한 주의 거래일입니다.", "Top 20 by foreign net selling over the last 5 sessions · the five pips are the week's sessions."),
  };

  return (
    <div className="d2-flowdesk">
      <Marker
        options={[
          { id: "kospi", label: L("코스피 시총 50", "KOSPI top 50") },
          { id: "kosdaq", label: L("코스닥 시총 50", "KOSDAQ top 50") },
          { id: "investor", label: L("투자자별 매매동향", "Flows by stock") },
          { id: "fbuy", label: L("외국인 주간 순매수", "Foreign weekly buys") },
          { id: "fsell", label: L("외국인 주간 순매도", "Foreign weekly sells") },
        ]}
        value={tab}
        onChange={setTab}
        label={L("수급 표 선택", "Choose table")}
      />
      <p className="d2-flow-note">{notes[tab]}</p>
      {tab === "kospi" && <Top50 key="kospi" market="KOSPI" />}
      {tab === "kosdaq" && <Top50 key="kosdaq" market="KOSDAQ" />}
      {tab === "investor" && <InvestorTable items={investor} loading={investorLoading} error={investorError} />}
      {tab === "fbuy" && <WeeklyTable items={weekly.buy} loading={weeklyLoading} error={weeklyError} side="buy" />}
      {tab === "fsell" && <WeeklyTable items={weekly.sell} loading={weeklyLoading} error={weeklyError} side="sell" />}
    </div>
  );
}
