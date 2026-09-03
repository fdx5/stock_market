import { useEffect, useMemo, useState } from "react";
import { EtfItem, MarketMapItem, StockSearchResult, api } from "../api/client";
import { trillionSuffix, wonSuffix } from "../i18n/format";
import { Lang, useLanguage, useT } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { Link, navigate } from "../router";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { useMarketSnapshot } from "../useMarketSnapshot";
import { useUsMarketSnapshot } from "../useUsMarketSnapshot";
import SessionBadge from "./SessionBadge";
import StockLogo from "./StockLogo";
import TabBeacon from "./TabBeacon";

/* 실시간 랭킹 — the desk's 순위 board.
 *
 * One ranked list of ten, over five orderings a reader can flip between without a
 * refetch, for each of the two markets. The orderings are the ones a market ranking
 * is actually read for — where the money went (거래대금), where the shares went
 * (거래량), what moved (상승/하락), and what is simply biggest (시가총액).
 *
 * Costs no requests of its own. Both sides come from the refcounted snapshots the
 * desk already subscribes to — useMarketSnapshot for KOSPI 500 + KOSDAQ 200, which
 * the breadth gauge and the spotlight board are built from, and useUsMarketSnapshot
 * for the S&P 500 + NASDAQ 100 union. Every ordering is derived per render from the
 * one snapshot, so changing a chip is a sort, not a round trip.
 *
 * The US snapshot is the one thing here that is not already paid for on this page,
 * which is why the US group is its own component: the hook lives inside it, so on a
 * phone — where only the selected market is mounted — a reader who never opens 미국
 * never starts that poll.
 */

/** Naver's own row count for this band, and the right one: ten names is a ranking, a
 * longer list is a table and belongs on the ranking pages this links out to. */
const ROWS = 10;

/** Below this a change is a rounding artefact on a mega cap rather than a move, and a
 * 상승 list full of +0.01% reads as broken. Same threshold as UsRankBoard. */
const MIN_MOVE = 0.01;

export type RankSort = "amount" | "volume" | "up" | "down" | "marcap";

const SORTS: { id: RankSort; label: string }[] = [
  { id: "amount", label: "거래대금" },
  { id: "volume", label: "거래량" },
  { id: "up", label: "상승" },
  { id: "down", label: "하락" },
  { id: "marcap", label: "시가총액" },
];

type RankMarket = "KR" | "US";

function MarketFlag({ market }: { market: RankMarket }) {
  return (
    <img
      className="desk-rank-market-flag"
      src={`/img/flag/${market === "KR" ? "kr" : "us"}.svg`}
      alt=""
      loading="lazy"
      decoding="async"
    />
  );
}

/** A snapshot row plus the board it came from. The two KR maps are separate responses
 * and the merged ranking has to remember which is which — selecting a KOSDAQ name with
 * market "KOSPI" sends the workspace to the wrong roster, and `sector` already means
 * the industry here and cannot be borrowed to carry it. US rows are all one board. */
type RankRow = MarketMapItem & { board: "KOSPI" | "KOSDAQ" | "US" };

/** Below this the two market groups stop fitting side by side and the board switches
 * to Naver's phone shape: a 국내/미국 toggle with one group under it. Structure, not
 * styling — the unselected market is not hidden but unmounted, which is what keeps the
 * US snapshot's poll off a phone that never asks for it. */

/** A US row's cap is `market_cap` in dollars; `marcap` on the same object is the
 * constituent's index weight in per cent, which is a different quantity wearing the
 * same name (see MarketMapItem). Getting this wrong ranks the US board by weight and
 * prints "0.1조" against Apple. */
function capOf(item: MarketMapItem, market: RankMarket): number {
  return market === "US" ? item.market_cap ?? 0 : item.marcap;
}

/** 거래대금. Neither market's upstream publishes it, and both publish the two numbers
 * it is the product of, so it is computed here rather than being a field that is
 * missing on one side. Zero when the snapshot carries no volume for that name, which
 * drops it out of the two turnover orderings rather than ranking it as free. */
function turnoverOf(item: MarketMapItem): number {
  return item.turnover ?? (item.volume ?? 0) * item.close;
}

function metricOf(item: MarketMapItem, sort: RankSort, market: RankMarket): number {
  switch (sort) {
    case "amount":
      return turnoverOf(item);
    case "volume":
      return item.volume ?? 0;
    case "marcap":
      return capOf(item, market);
    default:
      return item.change_pct;
  }
}

/** KRW in the unit a Korean figure is actually quoted in, USD in the unit an American
 * one is. Both are the ranking's own metric printed under the name, so both have to be
 * short enough to sit on one line next to a price. */
function moneyText(value: number, market: RankMarket, lang: Lang): string {
  if (!value) return "-";
  if (market === "US") {
    if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
    if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    return `$${(value / 1e6).toFixed(0)}M`;
  }
  if (value >= 1e12) return `${(value / 1e12).toFixed(1)}${trillionSuffix(lang)}`;
  return `${Math.round(value / 1e8).toLocaleString()}${lang === "en" ? "00M" : "억"}`;
}

function volumeText(value: number, lang: Lang): string {
  if (!value) return "-";
  if (value >= 1e8) return `${(value / 1e8).toFixed(1)}${lang === "en" ? "00M" : "억"}`;
  if (value >= 1e4) return `${Math.round(value / 1e4).toLocaleString()}${lang === "en" ? "0k" : "만"}`;
  return value.toLocaleString();
}

function metricText(item: MarketMapItem, sort: RankSort, market: RankMarket, lang: Lang): string {
  const value = metricOf(item, sort, market);
  if (sort === "volume") return `${volumeText(value, lang)}${lang === "en" ? "" : "주"}`;
  if (sort === "amount" || sort === "marcap") return moneyText(value, market, lang);
  return "";
}

function priceText(item: MarketMapItem, market: RankMarket, lang: Lang): string {
  if (market === "US") return `$${item.close.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `${item.close.toLocaleString()}${wonSuffix(lang)}`;
}

function toneOf(changePct: number): "up" | "down" | "flat" {
  return changePct > 0 ? "up" : changePct < 0 ? "down" : "flat";
}

/** The ranking itself. Sorted per render out of the one snapshot — flipping a chip
 * never refetches, which is the whole point of holding the universe rather than asking
 * the server for each ordering. */
function rank(items: RankRow[], sort: RankSort, market: RankMarket): RankRow[] {
  if (sort === "up" || sort === "down") {
    const direction = sort === "up" ? 1 : -1;
    return items
      .filter((item) => item.change_pct * direction >= MIN_MOVE)
      .sort((a, b) => (b.change_pct - a.change_pct) * direction)
      .slice(0, ROWS);
  }
  const ranked = items
    .map((item) => ({ item, metric: metricOf(item, sort, market) }))
    .filter((row) => row.metric > 0)
    .sort((a, b) => b.metric - a.metric)
    .slice(0, ROWS)
    .map((row) => row.item);
  // An upstream session transition must not turn a ranking tab into an empty panel.
  // Normally Naver's NXT counters populate these two sorts; if a quote chunk is
  // temporarily missing, retain ten recognizable names in cap order until the next
  // minute poll replaces them with the real volume/value order.
  if (ranked.length === 0 && (sort === "amount" || sort === "volume")) {
    return [...items].sort((a, b) => capOf(b, market) - capOf(a, market)).slice(0, ROWS);
  }
  return ranked;
}

function RankRows({
  items,
  sort,
  market,
  loading,
  onSelectStock,
}: {
  items: RankRow[];
  sort: RankSort;
  market: RankMarket;
  loading: boolean;
  onSelectStock: (stock: StockSearchResult) => void;
}) {
  const { lang } = useLanguage();
  const t = useT();
  // KR names are already Korean and US ones are wordmarks a Korean reader knows in
  // English; only the KR side has anything to translate, and only into English.
  const translated = useTranslatedTexts(market === "KR" ? items.map((item) => item.name) : []);

  if (loading) {
    return (
      <ol className="desk-rank-list" aria-hidden="true">
        {Array.from({ length: ROWS }, (_, index) => (
          <li key={`skeleton-${index}`}>
            <span className="desk-rank-row is-skeleton">
              <span className="skeleton" style={{ height: 16 }} />
            </span>
          </li>
        ))}
      </ol>
    );
  }

  if (items.length === 0) {
    return <p className="desk-rank-empty">{t("아직 집계된 종목이 없습니다.")}</p>;
  }

  return (
    <ol className="desk-rank-list">
      {items.map((item, index) => {
        const tone = toneOf(item.change_pct);
        const metric = metricText(item, sort, market, lang);
        return (
          <li key={item.code}>
            <button
              type="button"
              className={`desk-rank-row is-${tone}`}
              onClick={() =>
                onSelectStock({ code: item.code, name: item.name, market: item.board })
              }
              title={`${item.name} (${item.code})`}
            >
              <span className={`desk-rank-no ${index < 3 ? "is-top" : ""}`}>{index + 1}</span>
              <StockLogo code={item.code} name={item.name} className="desk-rank-logo" />
              <span className="desk-rank-id">
                <b>{translated[index] ?? item.name}</b>
                {metric && <small>{metric}</small>}
              </span>
              <span className="desk-rank-figures">
                <b>{priceText(item, market, lang)}</b>
                <small className={`change-${tone}`}>
                  {item.change_pct >= 0 ? "+" : ""}
                  {item.change_pct.toFixed(2)}%
                </small>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** The 국내 group. Reads the snapshot the desk is already subscribed to, so it costs
 * nothing beyond the sort. */
function KrRankGroup({
  sort,
  onSelectStock,
  showHeader,
}: {
  sort: RankSort;
  onSelectStock: (stock: StockSearchResult) => void;
  showHeader: boolean;
}) {
  const t = useT();
  const snapshot = useMarketSnapshot();
  const universe = useMemo<RankRow[]>(
    () => [
      ...snapshot.kospi.map((item) => ({ ...item, board: "KOSPI" as const })),
      ...snapshot.kosdaq.map((item) => ({ ...item, board: "KOSDAQ" as const })),
    ],
    [snapshot.kospi, snapshot.kosdaq],
  );
  const items = useMemo(() => rank(universe, sort, "KR"), [universe, sort]);

  return (
    <section className="desk-rank-group" aria-label={t("국내 실시간 랭킹")}>
      {showHeader && (
        <header className="desk-rank-group-head">
          <h4>{t("국내")}<MarketFlag market="KR" /></h4>
          <span>{t("코스피 500 · 코스닥 200")}</span>
        </header>
      )}
      <RankRows
        items={items}
        sort={sort}
        market="KR"
        loading={snapshot.generatedAt === null}
        onSelectStock={onSelectStock}
      />
      <Link className="desk-rank-more" to="/stocks">
        {t("전체 랭킹 보기")} →
      </Link>
    </section>
  );
}

/** The 미국 group, and the only subscriber on this page to the US snapshot — see the
 * file header for why that subscription lives down here rather than at the top. */
function UsRankGroup({
  sort,
  onSelectStock,
  showHeader,
}: {
  sort: RankSort;
  onSelectStock: (stock: StockSearchResult) => void;
  showHeader: boolean;
}) {
  const t = useT();
  const snapshot = useUsMarketSnapshot();
  const items = useMemo(
    () => rank(snapshot.all.map((item) => ({ ...item, board: "US" as const })), sort, "US"),
    [snapshot.all, sort],
  );

  return (
    <section className="desk-rank-group" aria-label={t("미국 실시간 랭킹")}>
      {showHeader && (
        <header className="desk-rank-group-head">
          <h4>{t("미국")}<MarketFlag market="US" /></h4>
          <span>
            {t("S&P 500 · 나스닥 100")}
            <SessionBadge session={snapshot.session ?? undefined} compact />
          </span>
        </header>
      )}
      <RankRows
        items={items}
        sort={sort}
        market="US"
        loading={snapshot.generatedAt === null}
        onSelectStock={onSelectStock}
      />
      <Link className="desk-rank-more" to="/nasdaq-100">
        {t("전체 랭킹 보기")} →
      </Link>
    </section>
  );
}

function rankEtfs(items: EtfItem[], sort: RankSort): EtfItem[] {
  if (sort === "up" || sort === "down") {
    const direction = sort === "up" ? 1 : -1;
    return [...items]
      .filter((item) => item.change_pct * direction >= MIN_MOVE)
      .sort((a, b) => (b.change_pct - a.change_pct) * direction)
      .slice(0, ROWS);
  }
  const metric = sort === "volume" ? (item: EtfItem) => item.volume : (item: EtfItem) => item.turnover;
  const ranked = [...items]
    .filter((item) => metric(item) > 0)
    .sort((a, b) =>
      metric(b) - metric(a),
    )
    .slice(0, ROWS);
  return ranked.length > 0 ? ranked : items.slice(0, ROWS);
}

function EtfRankGroup({ region, sort }: { region: RankMarket; sort: RankSort }) {
  const { lang } = useLanguage();
  const t = useT();
  const [items, setItems] = useState<EtfItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.etfs(region).then((result) => {
        if (!cancelled) setItems(result.items);
      }).catch(() => {}).finally(() => {
        if (!cancelled) setLoading(false);
      });
    };
    load();
    const stop = startVisibilityAwareInterval(load, 10_000);
    return () => { cancelled = true; stop(); };
  }, [region]);

  const ranked = useMemo(() => rankEtfs(items, sort), [items, sort]);
  return (
    <section className="desk-rank-group" aria-label={t(region === "KR" ? "국내 ETF 랭킹" : "해외 ETF 랭킹")}>
      <header className="desk-rank-group-head">
        <h4>
          {t(region === "KR" ? "국내 ETF" : "해외 ETF")}
          <MarketFlag market={region} />
        </h4>
        <span>{sort === "marcap" ? t("ETF는 거래대금 기준") : region === "KR" ? "KRX ETF" : "US ETF"}</span>
      </header>
      {loading ? (
        <ol className="desk-rank-list" aria-hidden="true">
          {Array.from({ length: ROWS }, (_, index) => <li key={index}><span className="desk-rank-row is-skeleton"><span className="skeleton" style={{ height: 16 }} /></span></li>)}
        </ol>
      ) : (
        <ol className="desk-rank-list">
          {ranked.map((item, index) => {
            const tone = toneOf(item.change_pct);
            const metric = sort === "amount" || sort === "marcap"
              ? moneyText(item.turnover, region, lang)
              : sort === "volume" ? `${volumeText(item.volume, lang)}${lang === "en" ? "" : "주"}` : "";
            return (
              <li key={item.code}>
                <button type="button" className={`desk-rank-row is-${tone}`} onClick={() => navigate(`/discussion-explorer?code=${encodeURIComponent(item.code)}&name=${encodeURIComponent(item.name)}&market=${region}&asset=ETF`)}>
                  <span className={`desk-rank-no ${index < 3 ? "is-top" : ""}`}>{index + 1}</span>
                  <StockLogo code={item.code} name={item.name} className="desk-rank-logo" assetType="etf" />
                  <span className="desk-rank-id"><b>{item.name}</b>{metric && <small>{metric}</small>}</span>
                  <span className="desk-rank-figures"><b>{region === "US" ? `$${item.close.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : `${item.close.toLocaleString()}${wonSuffix(lang)}`}</b><small className={`change-${tone}`}>{item.change_pct >= 0 ? "+" : ""}{item.change_pct.toFixed(2)}%</small></span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <Link className="desk-rank-more" to="/etf">{t("전체 ETF 보기")} →</Link>
    </section>
  );
}

export default function DeskRealtimeRanking({
  onSelectStock,
}: {
  onSelectStock: (stock: StockSearchResult) => void;
}) {
  const t = useT();
  /* Null until the reader picks one — see `sort` below. The KR snapshot is read here
     as well as inside the group; it is a refcounted singleton, so a second subscriber
     is free. */
  const [chosenSort, setChosenSort] = useState<RankSort | null>(null);
  const snapshot = useMarketSnapshot();

  /* Between the previous close and the opening auction, KRX's own session counters are
     reset and every 거래량 upstream reports is zero — so a 거래대금 ranking in that
     window is not a short list, it is an empty one, and it would be the first thing on
     the band for the couple of hours a Seoul morning is spent reading it. The opening
     chip therefore falls back to 시가총액, which is defined at every hour of the day.
     Only the *initial* chip: once a reader has picked one, that choice stands whatever
     the data does. */
  const hasTurnover = useMemo(
    () => [...snapshot.kospi, ...snapshot.kosdaq].some((item) => (item.volume ?? 0) > 0),
    [snapshot.kospi, snapshot.kosdaq],
  );
  const sort: RankSort =
    chosenSort ?? (snapshot.generatedAt !== null && !hasTurnover ? "marcap" : "amount");
  const setSort = setChosenSort;

  return (
    <div className="desk-rank">
      <div className="desk-rank-head">
        <h3>{t("실시간 랭킹")}</h3>
      </div>

      {/* Horizontally scrollable rather than wrapped: five chips wrap to two lines at
          exactly the widths a phone is held at, and a second line of chips pushes the
          ranking itself below the fold. */}
      <div className="desk-rank-chips" role="tablist" aria-label={t("랭킹 기준")}>
        {SORTS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={sort === option.id}
            className={`${sort === option.id ? "is-on" : ""} ${option.id === "up" || option.id === "down" ? "has-beacon" : ""}`.trim()}
            onClick={() => setSort(option.id)}
          >
            {(option.id === "up" || option.id === "down") && (
              <TabBeacon tone={option.id} />
            )}
            {t(option.label)}
          </button>
        ))}
      </div>

      <div className="desk-rank-groups is-quad">
        <KrRankGroup sort={sort} onSelectStock={onSelectStock} showHeader />
        <EtfRankGroup region="KR" sort={sort} />
        <UsRankGroup sort={sort} onSelectStock={onSelectStock} showHeader />
        <EtfRankGroup region="US" sort={sort} />
      </div>
    </div>
  );
}
