import { useEffect, useMemo, useState } from "react";
import { EtfItem, MarketMapItem, api } from "../api/client";
import { Lang, useLanguage } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link } from "../router";
import { useMarketSnapshot } from "../useMarketSnapshot";
import { useMediaQuery } from "../useMediaQuery";
import { useUsMarketSnapshot } from "../useUsMarketSnapshot";
import StockLogo from "../components/StockLogo";
import { Marker, Skel } from "./parts";
import { krwPrice, openEtf, openStock, pct, shares, toneOf, turnoverOf, usd, usdPrice, useL, won } from "./lib";

/* 04 실시간 순위.
 *
 * Four boards — 국내 주식, 국내 ETF, 미국 주식, 미국 ETF — under one set of five
 * orderings, exactly what the classic 실시간 랭킹 carried. Every ordering is a
 * sort of a snapshot the page already holds, so flipping between them costs no
 * request. On a phone only the chosen board is mounted, which keeps the US and
 * ETF polls off a handset that never asks for them. */

type Sort = "amount" | "volume" | "up" | "down" | "marcap";
type Board = "kr" | "kretf" | "us" | "usetf";
const ROWS = 10;
const MIN_MOVE = 0.01;

interface Row {
  code: string;
  name: string;
  close: number;
  change_pct: number;
  metric: string;
  etf?: boolean;
  market: string;
}

function capOf(item: MarketMapItem, us: boolean): number {
  return us ? item.market_cap ?? 0 : item.marcap;
}

function rankStocks(all: (MarketMapItem & { board: string })[], sort: Sort, us: boolean, lang: Lang): Row[] {
  // A row without a price is a feed gap, not a quote; it must never rank.
  const items = all.filter((it) => it.close > 0);
  const metricOf = (it: MarketMapItem) =>
    sort === "amount" ? turnoverOf(it) : sort === "volume" ? it.volume ?? 0 : sort === "marcap" ? capOf(it, us) : it.change_pct;
  let ranked: (MarketMapItem & { board: string })[];
  if (sort === "up" || sort === "down") {
    const dir = sort === "up" ? 1 : -1;
    ranked = items.filter((it) => it.change_pct * dir >= MIN_MOVE).sort((a, b) => (b.change_pct - a.change_pct) * dir);
  } else {
    ranked = items.filter((it) => metricOf(it) > 0).sort((a, b) => metricOf(b) - metricOf(a));
    // Before the KRX opens every volume is zero; keep ten recognisable names
    // (by size) rather than an empty board.
    if (ranked.length === 0) ranked = [...items].sort((a, b) => capOf(b, us) - capOf(a, us));
  }
  return ranked.slice(0, ROWS).map((it) => {
    const m = metricOf(it);
    const metric =
      sort === "volume" ? shares(m, lang) : sort === "amount" || sort === "marcap" ? (us ? usd(m) : won(m, lang)) : "";
    return { code: it.code, name: it.name, close: it.close, change_pct: it.change_pct, metric, market: it.board };
  });
}

function rankEtfs(items: EtfItem[], sort: Sort, region: "KR" | "US", lang: Lang): Row[] {
  let ranked: EtfItem[];
  if (sort === "up" || sort === "down") {
    const dir = sort === "up" ? 1 : -1;
    ranked = items.filter((it) => it.change_pct * dir >= MIN_MOVE).sort((a, b) => (b.change_pct - a.change_pct) * dir);
  } else {
    const metric = sort === "volume" ? (it: EtfItem) => it.volume : (it: EtfItem) => it.turnover;
    ranked = items.filter((it) => metric(it) > 0).sort((a, b) => metric(b) - metric(a));
    if (ranked.length === 0) ranked = items;
  }
  return ranked.slice(0, ROWS).map((it) => ({
    code: it.code,
    name: it.name,
    close: it.close,
    change_pct: it.change_pct,
    etf: true,
    market: region,
    metric: sort === "volume" ? shares(it.volume, lang) : sort === "up" || sort === "down" ? "" : region === "US" ? usd(it.turnover) : won(it.turnover, lang),
  }));
}

function List({ rows, loading, us, translate }: { rows: Row[]; loading: boolean; us: boolean; translate?: boolean }) {
  const { lang } = useLanguage();
  const L = useL();
  const names = useTranslatedTexts(translate ? rows.map((r) => r.name) : []);
  if (loading) {
    return (
      <ol className="d2-rank-list" aria-hidden="true">
        {Array.from({ length: ROWS }, (_, i) => (
          <li key={i} className="is-skel">
            <Skel h={16} />
          </li>
        ))}
      </ol>
    );
  }
  if (rows.length === 0) return <p className="d2-empty">{L("아직 집계된 종목이 없습니다.", "Nothing ranked yet.")}</p>;
  return (
    <ol className="d2-rank-list">
      {rows.map((r, i) => {
        const tone = toneOf(r.change_pct);
        return (
          <li key={r.code}>
            <button
              type="button"
              className={`is-${tone}`}
              onClick={() => (r.etf ? openEtf(r.code) : openStock({ code: r.code, name: r.name, market: r.market }))}
              title={`${r.name} (${r.code})`}
            >
              <span className={`d2-rank-no ${i < 3 ? "is-top" : ""}`}>{i + 1}</span>
              <StockLogo code={r.code} name={r.name} className="d2-rank-logo" assetType={r.etf ? "etf" : "stock"} />
              <span className="d2-rank-id">
                <b>{names[i] ?? r.name}</b>
                {r.metric && <small>{r.metric}</small>}
                {/* KRX caps a day's move at ±30%; only a first trading day, priced
                    against the offer price, goes beyond it. Say so, so it does not
                    read as a bad number. */}
                {!us && !r.etf && Math.abs(r.change_pct) > 30 && <em className="d2-rank-tag">{L("신규상장 · 공모가 대비", "New listing · vs offer")}</em>}
              </span>
              <span className="d2-rank-fig">
                <b>{us ? usdPrice(r.close) : krwPrice(r.close, lang)}</b>
                <small>{pct(r.change_pct)}</small>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function KrStocks({ sort }: { sort: Sort }) {
  const { lang } = useLanguage();
  const snap = useMarketSnapshot();
  const rows = useMemo(
    () =>
      rankStocks(
        [...snap.kospi.map((it) => ({ ...it, board: "KOSPI" })), ...snap.kosdaq.map((it) => ({ ...it, board: "KOSDAQ" }))],
        sort,
        false,
        lang
      ),
    [snap.kospi, snap.kosdaq, sort, lang]
  );
  return <List rows={rows} loading={snap.generatedAt === null} us={false} translate={lang === "en"} />;
}

function UsStocks({ sort }: { sort: Sort }) {
  const { lang } = useLanguage();
  const snap = useUsMarketSnapshot();
  const rows = useMemo(() => rankStocks(snap.all.map((it) => ({ ...it, board: "US" })), sort, true, lang), [snap.all, sort, lang]);
  return <List rows={rows} loading={snap.generatedAt === null} us />;
}

function Etfs({ region, sort }: { region: "KR" | "US"; sort: Sort }) {
  const { lang } = useLanguage();
  const [items, setItems] = useState<EtfItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .etfs(region)
        .then((res) => {
          if (!cancelled && res.items.length > 0) setItems(res.items);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    load();
    const stop = startVisibilityAwareInterval(load, 10_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [region]);
  const rows = useMemo(() => rankEtfs(items, sort, region, lang), [items, sort, region, lang]);
  return <List rows={rows} loading={loading} us={region === "US"} />;
}

function UsSession() {
  const L = useL();
  const snap = useUsMarketSnapshot();
  if (snap.session !== "pre" && snap.session !== "post") return null;
  return <em className="d2-session">{snap.session === "pre" ? L("프리장", "Pre") : L("애프터장", "After")}</em>;
}

export default function RankingDesk() {
  const L = useL();
  const snapshot = useMarketSnapshot();
  const narrow = useMediaQuery("(max-width: 760px)");
  const [chosen, setChosen] = useState<Sort | null>(null);
  const [board, setBoard] = useState<Board>("kr");
  const hasTurnover = useMemo(() => [...snapshot.kospi, ...snapshot.kosdaq].some((it) => (it.volume ?? 0) > 0), [snapshot.kospi, snapshot.kosdaq]);
  const sort: Sort = chosen ?? (snapshot.generatedAt !== null && !hasTurnover ? "marcap" : "amount");

  const sorts: { id: Sort; label: string }[] = [
    { id: "amount", label: L("거래대금", "Turnover") },
    { id: "volume", label: L("거래량", "Volume") },
    { id: "up", label: L("상승률", "Gainers") },
    { id: "down", label: L("하락률", "Losers") },
    { id: "marcap", label: L("시가총액", "Market cap") },
  ];
  const boards: { id: Board; label: string; sub: string; more: { to: string; label: string }; body: JSX.Element }[] = [
    { id: "kr", label: L("국내 주식", "Korea"), sub: L("코스피 500 · 코스닥 200", "KOSPI 500 · KOSDAQ 200"), more: { to: "/stocks", label: L("전체 순위", "Full ranking") }, body: <KrStocks sort={sort} /> },
    { id: "kretf", label: L("국내 ETF", "Korea ETFs"), sub: sort === "marcap" ? L("ETF는 거래대금 기준", "ETFs by turnover") : "KRX ETF", more: { to: "/etf", label: L("ETF 전체", "All ETFs") }, body: <Etfs region="KR" sort={sort} /> },
    { id: "us", label: L("미국 주식", "US"), sub: L("S&P 500 · 나스닥 100", "S&P 500 · NASDAQ 100"), more: { to: "/nasdaq-100", label: L("전체 순위", "Full ranking") }, body: <UsStocks sort={sort} /> },
    { id: "usetf", label: L("미국 ETF", "US ETFs"), sub: sort === "marcap" ? L("ETF는 거래대금 기준", "ETFs by turnover") : "US ETF", more: { to: "/etf", label: L("ETF 전체", "All ETFs") }, body: <Etfs region="US" sort={sort} /> },
  ];
  const visible = narrow ? boards.filter((b) => b.id === board) : boards;

  return (
    <div className="d2-rank">
      <div className="d2-rank-controls">
        <Marker options={sorts} value={sort} onChange={setChosen} label={L("순위 기준", "Rank by")} />
        {narrow && (
          <Marker
            className="d2-marker--boards"
            options={boards.map((b) => ({ id: b.id, label: b.label }))}
            value={board}
            onChange={setBoard}
            label={L("시장 선택", "Market")}
          />
        )}
      </div>
      <div className="d2-rank-boards">
        {visible.map((b) => (
          <section key={b.id} className="d2-rank-board" aria-label={b.label}>
            <header>
              <h3>
                <img src={`/img/flag/${b.id.startsWith("kr") ? "kr" : "us"}.svg`} alt="" />
                {b.label}
                {b.id === "us" && <UsSession />}
              </h3>
              <small>{b.sub}</small>
            </header>
            {b.body}
            <Link to={b.more.to} className="d2-more">
              {b.more.label} →
            </Link>
          </section>
        ))}
      </div>
    </div>
  );
}
