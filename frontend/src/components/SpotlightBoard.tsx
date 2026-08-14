import { useEffect, useMemo, useRef, useState } from "react";
import { DailyPricePoint, EtfItem, StockSearchResult, api } from "../api/client";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { wonSuffix } from "../i18n/format";
import { useMediaQuery } from "../useMediaQuery";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import {
  BoardKind,
  SpotlightPick,
  pickSpotlight,
  sessionBucket,
  usSessionBucket,
} from "../spotlight";
import { useMarketSnapshot } from "../useMarketSnapshot";
import { useUsMarketSnapshot } from "../useUsMarketSnapshot";
import { navigate } from "../router";
import { startVisibilityAwareInterval } from "../pollVisibility";
import SpotSparkline from "./SpotSparkline";
import StockLogo from "./StockLogo";

/* 오늘의 주목 종목 — three per board, wide cards, with a line of context.
 *
 * The picking and the commentary are in spotlight.ts, which is also where the
 * note on why none of it comes from a language model lives. This file is the
 * board: two rows, the session badge, and the rule that keeps the six still.
 *
 * That rule is the only interesting thing here. The snapshot behind it refreshes
 * every minute, and re-running the selection on every refresh would have the
 * cards reshuffle under a reader mid-sentence — the ranking near the cut is
 * close enough that a fourth-place name overtakes a third-place one on almost
 * every tick. So the pick is memoised on the session bucket: it is computed on
 * the first snapshot of a bucket and then held, whatever arrives afterwards,
 * until the clock moves the bucket on. The prices on the cards keep updating;
 * which six cards they are does not. */

const CLOCK_MS = 30_000;
/** How many sessions the card's line covers. A month of trading is enough to
 * show whether today is the start of something or the top of a run, and short
 * enough that one day still visibly moves the shape. */
const SPARK_DAYS = 20;
/* The line is drawn only where there is room beside the text for it to be more
 * than a smudge. Below this the card is already stacking its own header, and a
 * 130px chart squeezed under a wrapped stock name is worse than no chart — so
 * the six requests are not made at all rather than made and hidden. */
const SPARK_QUERY = "(min-width: 1181px)";
const SPOTLIGHT_ETFS = ["SPY", "QQQ", "SCHD"];

export default function SpotlightBoard({
  onSelect,
  activeCode,
  kind = "kr",
}: {
  onSelect: (stock: StockSearchResult) => void;
  activeCode?: string;
  /** "kr" draws KOSPI and KOSDAQ, "us" the S&P 500 and NASDAQ 100. They differ
   * in more than their contents — see BoardKind in spotlight.ts. */
  kind?: BoardKind;
}) {
  const t = useT();
  /* Both hooks are called unconditionally, because hooks are. Each is a
     refcounted singleton whose poll only starts once it has a subscriber, so the
     unused one costs a subscription to a poller the other page is not running —
     no request and no timer. */
  const krSnapshot = useMarketSnapshot();
  const usSnapshot = useUsMarketSnapshot();
  const isUs = kind === "us";
  const [etfs, setEtfs] = useState<EtfItem[]>([]);

  useEffect(() => {
    if (!isUs) return;
    let cancelled = false;
    const load = () => api.etfs("US").then((response) => {
        if (cancelled) return;
        const byCode = new Map(response.items.map((item) => [item.code, item]));
        setEtfs(SPOTLIGHT_ETFS.map((code) => byCode.get(code)).filter((item): item is EtfItem => Boolean(item)));
      }).catch(() => {
        // The two stock rows remain useful if the independent ETF feed is unavailable.
      });
    load();
    const stop = startVisibilityAwareInterval(load, 60_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [isUs]);

  const snapshot = isUs
    ? {
        generatedAt: usSnapshot.generatedAt,
        boards: [
          { items: usSnapshot.sp500, name: "S&P 500" as const },
          { items: usSnapshot.nasdaq, name: "NASDAQ 100" as const },
        ],
      }
    : {
        generatedAt: krSnapshot.generatedAt,
        boards: [
          { items: krSnapshot.kospi, name: "KOSPI" as const },
          { items: krSnapshot.kosdaq, name: "KOSDAQ" as const },
        ],
      };

  /* The bucket is read from a clock of its own rather than derived at render
     time — a page left open across 09:00 would otherwise keep yesterday's
     closing six until something unrelated happened to re-render it. Thirty
     seconds is well inside the shortest bucket (an hour) and costs one Date. */
  /* A clock of its own rather than a value derived at render time — a page left
     open across 09:00 would otherwise keep yesterday's closing six until
     something unrelated happened to re-render it. Thirty seconds is well inside
     the shortest window (an hour) and costs one Date.

     `tick` only exists to make that clock a dependency; the bucket itself is
     recomputed below, because on the US side it also depends on the session
     flag, which arrives with the snapshot rather than with the clock. */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), CLOCK_MS);
    return () => window.clearInterval(id);
  }, []);

  /* Which window the six belong to. The two boards are on two clocks, and they
     have to be: the whole New York regular session falls inside one Seoul
     "after close" bucket, so keying the US board on Seoul time froze its six for
     the entire session. See usSessionBucket. */
  const bucket = useMemo(
    () => (isUs ? usSessionBucket(usSnapshot.session, new Date()) : sessionBucket()),
    // `tick` is the point of the dependency; the value is never read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isUs, usSnapshot.session, tick]
  );
  const phase = bucket.phase;
  /* Held across snapshot refreshes, replaced only when the bucket changes. The
     ref is the memo: useMemo on [bucket.key] alone would recompute whenever
     React felt like dropping the cache, and on [bucket.key, snapshot] would
     recompute every minute, which is the thing being avoided. */
  const heldRef = useRef<{ key: string; picks: SpotlightPick[] } | null>(null);
  const picks = useMemo(() => {
    const held = heldRef.current;
    if (held && held.key === bucket.key && held.picks.length > 0) return held.picks;
    if (snapshot.generatedAt === null) return [];
    /* The first board's picks are excluded from the second's. KOSPI and KOSDAQ
       are disjoint so it changes nothing there; the NASDAQ 100 is very nearly a
       subset of the S&P 500, and without it the same mega caps win both rows and
       "six in focus" is four. */
    const first = pickSpotlight(
      snapshot.boards[0].items,
      snapshot.boards[0].name,
      phase,
      kind
    );
    const taken = new Set(first.map((p) => p.item.code));
    const second = pickSpotlight(
      snapshot.boards[1].items,
      snapshot.boards[1].name,
      phase,
      kind,
      taken
    );
    const next = [...first, ...second];
    if (next.length === 0) return held?.picks ?? [];
    heldRef.current = { key: bucket.key, picks: next };
    return next;
  }, [bucket.key, phase, snapshot, kind]);

  /* Prices come from this minute's snapshot rather than from the frozen pick, so
     a card that was chosen at 09:00 still shows the 09:47 price. Looked up by
     code against the live lists. */
  const live = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const board of snapshot.boards) {
      for (const item of board.items) {
        map.set(item.code, [item.close, item.change, item.change_pct]);
      }
    }
    return map;
  }, [snapshot]);

  const names = useTranslatedTexts(picks.map((p) => p.item.name));
  const series = useSparklines(picks, useMediaQuery(SPARK_QUERY), kind);

  const firstName = snapshot.boards[0].name;
  const secondName = snapshot.boards[1].name;
  const firstRow = picks.filter((p) => p.market === firstName);
  const secondRow = picks.filter((p) => p.market === secondName);

  /* The US session flag is more specific than a Seoul clock and is what those
     rows are actually quoting from, so it names the badge on that page. */
  const phaseLabel = isUs
    ? usSnapshot.session === "pre"
      ? "프리마켓 기준"
      : usSnapshot.session === "post"
        ? "애프터마켓 기준"
        : "정규장 기준"
    : bucket.phase === "pre"
      ? "프리장 기준"
      : bucket.phase === "live"
        ? "장중 기준"
        : "장 마감 기준";

  if (picks.length === 0) {
    return (
      <div className="desk-spot" aria-busy="true">
        <div className="desk-spot-rows">
          {(isUs ? [0, 1, 2] : [0, 1]).map((row) => (
            <div className="desk-spot-row" key={row}>
              <div className="desk-spot-rowhead">
                <span className="skeleton" style={{ width: 54, height: 14 }} />
              </div>
              <div className="desk-spot-grid">
                {[0, 1, 2].map((i) => (
                  <div className="desk-spot-card is-skeleton" key={i}>
                    <span className="skeleton" style={{ height: 22 }} />
                    <span className="skeleton" style={{ height: 30 }} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="desk-spot">
      <div className="desk-spot-meta">
        <span className={`desk-spot-phase is-${bucket.phase}`}>{t(phaseLabel)}</span>
        <span className="desk-spot-note">
          {/* Turnover is not a figure yet during the KR pre-market hour — the
              volume column is the regular session's and reads zero until the
              KRX opens — so the six are picked on the move and on size there,
              and the caption has to say which. See turnoverIsReal. */}
          {t(
            !isUs && bucket.phase === "pre"
              ? "프리마켓 상승률을 기준으로 지수별 3종목을 선별합니다."
              : "상승률과 거래대금을 기준으로 지수별 3종목을 선별합니다."
          )}
        </span>
      </div>

      <div className="desk-spot-rows">
        <Row
          label={isUs ? "S&P 500" : "코스피"}
          picks={firstRow}
          names={names}
          offset={0}
          live={live}
          series={series}
          currency={isUs ? "usd" : "krw"}
          onSelect={onSelect}
          activeCode={activeCode}
        />
        <Row
          label={isUs ? "나스닥 100" : "코스닥"}
          picks={secondRow}
          names={names}
          offset={firstRow.length}
          live={live}
          series={series}
          currency={isUs ? "usd" : "krw"}
          onSelect={onSelect}
          activeCode={activeCode}
        />
        {isUs && <EtfRow items={etfs} />}
      </div>
    </div>
  );
}

const ETF_ISSUER_DOMAINS: Record<string, string> = {
  SPY: "ssga.com",
  QQQ: "invesco.com",
  SCHD: "schwabassetmanagement.com",
};

function EtfIssuerLogo({ code }: { code: string }) {
  const [failed, setFailed] = useState(false);
  const domain = ETF_ISSUER_DOMAINS[code];
  if (!domain || failed) return <span className="desk-spot-logo stock-logo--mono">{code.slice(0, 2)}</span>;
  return (
    <img
      className="desk-spot-logo stock-logo--us"
      src={`https://www.google.com/s2/favicons?domain_url=https://${domain}&sz=128`}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

function formatEtfTurnover(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${Math.round(value).toLocaleString()}`;
}

function EtfRow({ items }: { items: EtfItem[] }) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <section className="desk-spot-row desk-spot-row--etf" aria-label="ETF">
      <div className="desk-spot-rowhead">
        <h3>ETF</h3>
        <span className="desk-spot-rowrule" aria-hidden="true" />
      </div>
      <div className="desk-spot-grid">
        {items.map((item) => {
          const tone = item.change_pct > 0 ? "up" : item.change_pct < 0 ? "down" : "flat";
          const points: DailyPricePoint[] = item.sparkline.slice(-SPARK_DAYS).reverse().map((close, index) => ({
            date: String(index),
            close,
            open: close,
            high: close,
            low: close,
            change: 0,
            change_pct: 0,
            volume: 0,
            value: 0,
          }));
          return (
            <button
              type="button"
              key={item.code}
              className={`desk-spot-card is-${tone}`}
              onClick={() => navigate(`/discussion-explorer?code=${encodeURIComponent(item.code)}&name=${encodeURIComponent(item.name)}&market=US&asset=ETF`)}
            >
              <span className="desk-spot-top">
                <EtfIssuerLogo code={item.code} />
                <span className="desk-spot-id">
                  <b className="desk-spot-name">{item.name}</b>
                  <i className="desk-spot-sector">{item.code} · {item.benchmark}</i>
                </span>
                <span className="desk-spot-quote">
                  <b className="desk-spot-price">${item.close.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b>
                  <i className={`desk-spot-pct change-${tone}`}>
                    {item.change_pct >= 0 ? "+" : ""}{item.change_pct.toFixed(2)}%
                  </i>
                </span>
              </span>
              <span className="desk-spot-body">
                <span className="desk-spot-lines">
                  <em>{item.category} · {item.benchmark}</em>
                  <em>{t("거래대금")} {formatEtfTurnover(item.turnover)} · 20{t("일")} {item.returns.d20 == null ? "—" : `${item.returns.d20 >= 0 ? "+" : ""}${item.returns.d20.toFixed(2)}%`}</em>
                </span>
                <span className="desk-spot-sparkwrap">
                  <SpotSparkline points={points} tone={tone} />
                  <i className="desk-spot-sparklabel">{SPARK_DAYS}{t("일")}</i>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* Twenty sessions of closes for each of the six, fetched once per set.
 *
 * Six requests is the cost, and the two things that keep it honest are the key
 * and the gate. The key is the sorted code list, so the fetch runs when the
 * *set* changes — which is once a session bucket, not once a minute, because
 * the picks above it are frozen on the same bucket. And `enabled` is a desktop
 * media query, so a phone never issues them at all rather than issuing them for
 * lines it will not draw.
 *
 * Results accumulate rather than reset between sets: a stock that stays in the
 * spotlight from one hour to the next keeps its line through the changeover
 * instead of blanking and refetching. The map only ever grows within a session,
 * and six entries an hour is not a leak worth managing.
 */
function useSparklines(
  picks: SpotlightPick[],
  enabled: boolean,
  kind: BoardKind
): Map<string, DailyPricePoint[]> {
  const [series, setSeries] = useState<Map<string, DailyPricePoint[]>>(new Map());
  const codeKey = picks
    .map((p) => p.item.code)
    .sort()
    .join(",");

  useEffect(() => {
    if (!enabled || !codeKey) return;
    const codes = codeKey.split(",");
    let cancelled = false;

    for (const code of codes) {
      (kind === "us"
        ? api.usDailyPrices(code, 0, SPARK_DAYS)
        : api.dailyPrices(code, 0, SPARK_DAYS))
        .then((page) => {
          if (cancelled || page.items.length === 0) return;
          setSeries((prev) => {
            if (prev.has(code)) return prev;
            const next = new Map(prev);
            next.set(code, page.items);
            return next;
          });
        })
        .catch(() => {
          // One missing series draws no line on that card. The rest of the card
          // is the point of it and does not depend on this.
        });
    }

    return () => {
      cancelled = true;
    };
  }, [codeKey, enabled, kind]);

  return series;
}

function Row({
  label,
  picks,
  names,
  offset,
  live,
  series,
  currency,
  onSelect,
  activeCode,
}: {
  label: string;
  picks: SpotlightPick[];
  names: string[];
  /** Where this row starts in the flat `names` array. */
  offset: number;
  live: Map<string, number[]>;
  series: Map<string, DailyPricePoint[]>;
  currency: "krw" | "usd";
  onSelect: (stock: StockSearchResult) => void;
  activeCode?: string;
}) {
  const t = useT();
  const { lang } = useLanguage();
  if (picks.length === 0) return null;

  return (
    <section className="desk-spot-row" aria-label={t(label)}>
      <div className="desk-spot-rowhead">
        <h3>{t(label)}</h3>
        <span className="desk-spot-rowrule" aria-hidden="true" />
      </div>
      <div className="desk-spot-grid">
        {picks.map((pick, index) => {
          const item = pick.item;
          const [close, change, changePct] = live.get(item.code) ?? [
            item.close,
            item.change,
            item.change_pct,
          ];
          const tone = changePct > 0 ? "up" : changePct < 0 ? "down" : "flat";
          return (
            <button
              key={item.code}
              type="button"
              className={`desk-spot-card is-${tone} ${activeCode === item.code ? "is-active" : ""}`}
              onClick={() =>
                onSelect({
                  code: item.code,
                  name: item.name,
                  market: currency === "usd" ? "US" : pick.market,
                })
              }
            >
              <span className="desk-spot-top">
                <StockLogo code={item.code} className="desk-spot-logo" />
                <span className="desk-spot-id">
                  <b className="desk-spot-name">{names[offset + index] ?? item.name}</b>
                  <i className="desk-spot-sector">{item.sector}</i>
                </span>
                <span className="desk-spot-quote">
                  <b className="desk-spot-price">
                    {currency === "usd"
                      ? `$${close.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                      : `${close.toLocaleString()}${wonSuffix(lang)}`}
                  </b>
                  <i className={`desk-spot-pct change-${tone}`}>
                    {changePct >= 0 ? "▲" : "▼"}{" "}
                    {currency === "usd"
                      ? Math.abs(change).toFixed(2)
                      : Math.abs(change).toLocaleString()}{" "}
                    (
                    {changePct >= 0 ? "+" : ""}
                    {changePct}%)
                  </i>
                </span>
              </span>
              <span className="desk-spot-body">
                <span className="desk-spot-lines">
                  {pick.lines.map((line, i) => (
                    <em key={i}>{line}</em>
                  ))}
                </span>
                <span className="desk-spot-sparkwrap">
                  {(() => {
                    const bars = series.get(item.code);
                    if (!bars) return null;
                    return (
                      <>
                        <SpotSparkline points={bars} tone={tone} />
                        <i className="desk-spot-sparklabel">
                          {SPARK_DAYS}
                          {t("일")}
                        </i>
                      </>
                    );
                  })()}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
