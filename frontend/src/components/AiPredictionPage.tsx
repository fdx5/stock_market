import { useEffect, useMemo, useRef, useState } from "react";
import { PredictionDateOption, PredictionDay, PredictionItem, SessionScore, api } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import {
  accuracyTone,
  formatChangeRate,
  formatCountdown,
  formatFullDate,
  formatGeneratedAt,
  marketOpenInstant,
  marketOpenLabel,
  probabilities,
} from "../prediction";
import { Link } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import BattleIcon from "./BattleIcon";
import Footer from "./Footer";
import GlobalNewsIcon from "./GlobalNewsIcon";
import LanguageToggle from "./LanguageToggle";
import Logo from "./Logo";
import MarketIcon from "./MarketIcon";
import PredictionCard from "./PredictionCard";
import PredictionDetailModal from "./PredictionDetailModal";
import ThemeToggle from "./ThemeToggle";
import VisitorBadge from "./VisitorBadge";

type SortKey =
  | "marketcap"
  | "conviction"
  | "probability"
  | "reliability"
  | "change"
  | "accuracy"
  | "name";

const MARKET_LABELS: Record<string, string> = {
  KOSPI: "코스피",
  KOSDAQ: "코스닥",
  NASDAQ: "나스닥",
};

const SORT_LABELS: Record<SortKey, string> = {
  marketcap: "시가총액순",
  conviction: "확신도순",
  probability: "상승확률순",
  reliability: "신뢰도순",
  change: "등락률순",
  accuracy: "적중률순",
  name: "종목명순",
};

/** Live countdown to the opening bell of the session being predicted.
 *
 * This is the page's one genuinely time-sensitive element — the whole point of a
 * next-session forecast is that it expires at the open — so it ticks rather than
 * rendering a static string. Once the bell passes it swaps to a "장 시작" state
 * instead of counting into negative numbers.
 */
function OpenCountdown({ isoDate, market }: { isoDate: string; market: string }) {
  const target = useMemo(() => marketOpenInstant(isoDate, market), [isoDate, market]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!target) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [target]);

  if (!target) return null;
  const remaining = formatCountdown(target.getTime() - now);

  return (
    <div className="pred-countdown">
      <span className="pred-countdown-label">{marketOpenLabel(market)} 개장까지</span>
      {remaining ? (
        <span className="pred-countdown-value">{remaining}</span>
      ) : (
        <span className="pred-countdown-value pred-countdown-value--open">장이 시작되었습니다</span>
      )}
    </div>
  );
}

/** Weighted hit rate over the most recent `sessions` graded 예측일자. */
function rollup(scoreboard: SessionScore[], sessions: number) {
  const slice = scoreboard.slice(0, sessions);
  const total = slice.reduce((sum, s) => sum + s.total, 0);
  const hit = slice.reduce((sum, s) => sum + s.hit, 0);
  return { total, hit, rate: total ? Math.round((hit / total) * 100) : null };
}

/** The page's trust anchor, directly under the title: how the last checked session
 * actually turned out, and a bar per recent session behind it.
 *
 * It sits above the forecasts rather than below them on purpose. A prediction page
 * that shows its track record only after you scroll is asking to be believed first and
 * audited later; this asks to be audited first.
 */
function Scoreboard({ day }: { day: PredictionDay }) {
  const previous = day.previous_session;
  const recent = rollup(day.scoreboard, 20);
  if (!previous && recent.rate === null) return null;

  return (
    <div className="pred-scoreboard">
      {previous ? (
        <div className={`pred-score-headline pred-score-headline--${previous.rate !== null && previous.rate >= 50 ? "good" : "bad"}`}>
          <span className="pred-score-label">직전 채점 결과 · {previous.label}</span>
          <span className="pred-score-value">
            {previous.rate}
            <small>%</small>
          </span>
          <span className="pred-score-hint">
            {previous.total}종목 중 {previous.hit}종목 적중
          </span>
        </div>
      ) : null}

      {recent.rate !== null ? (
        <div className="pred-score-aggregate">
          <span className="pred-score-label">최근 20거래일 누적</span>
          <span className={`pred-score-agg-value pred-score-agg-value--${accuracyTone({ ...recent })}`}>
            {recent.rate}%
          </span>
          <span className="pred-score-hint">
            {recent.total}건 중 {recent.hit}건 적중
          </span>
        </div>
      ) : null}

      {day.scoreboard.length > 1 ? (
        <div className="pred-score-spark" role="img" aria-label="최근 채점된 예측일자별 적중률">
          {/* Oldest on the left so the series reads left-to-right like every other
              time axis on the site; the API returns it newest-first. */}
          {[...day.scoreboard].slice(0, 14).reverse().map((s) => (
            <span
              key={s.predict_date}
              className={`pred-score-bar pred-score-bar--${
                s.rate === null ? "none" : s.rate >= 60 ? "good" : s.rate >= 40 ? "mid" : "bad"
              }`}
              style={{ height: `${Math.max(8, s.rate ?? 0)}%` }}
              title={`${formatFullDate(s.predict_date)} · ${s.rate ?? "―"}% (${s.hit}/${s.total})`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
  hint,
  children,
}: {
  label: string;
  value?: string;
  tone?: "up" | "down" | "flat";
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`pred-stat${tone ? ` pred-stat--${tone}` : ""}`}>
      <span className="pred-stat-label">{label}</span>
      {value ? <span className="pred-stat-value">{value}</span> : null}
      {children}
      {hint ? <span className="pred-stat-hint">{hint}</span> : null}
    </div>
  );
}

/** The index and FX readings every stock in a market shares, pulled off the first row
 * that carries them.
 *
 * These are market-wide facts, so the right place for them is the group header, once —
 * they are the context the cards below are read *against*, not a property of any one
 * name. Read from the stored evidence rather than added to the API response so a past
 * session shows the numbers as they were that day. */
function MarketContext({ items }: { items: PredictionItem[] }) {
  const shared = useMemo(() => {
    for (const item of items) {
      const index = item.evidence.find((e) => e.category === "업종지수");
      const fx = item.evidence.find((e) => e.category === "환율");
      if (index || fx) return { index, fx };
    }
    return null;
  }, [items]);

  if (!shared) return null;
  return (
    <p className="pred-group-context">
      {shared.index ? (
        <span>
          <b>{shared.index.label}</b> {shared.index.value}
        </span>
      ) : null}
      {shared.fx ? (
        <span>
          <b>{shared.fx.label}</b> {shared.fx.value}
        </span>
      ) : null}
    </p>
  );
}

function CardSkeleton() {
  return (
    <div className="pred-card pred-card--skeleton" aria-hidden="true">
      <div className="pred-skeleton-row pred-skeleton-row--head" />
      <div className="pred-skeleton-row pred-skeleton-row--price" />
      <div className="pred-skeleton-row pred-skeleton-row--bar" />
    </div>
  );
}

function sortItems(items: PredictionItem[], key: SortKey): PredictionItem[] {
  const copy = [...items];
  if (key === "marketcap") {
    // The default. The roster *is* a market-cap top-10, so this is the order a reader
    // already has in their head — 삼성전자 first, not whichever name happened to score
    // highest. Rows written before the column existed have no cap and fall to the end
    // rather than jumping to the front on a null.
    copy.sort((a, b) => (b.market_cap ?? -1) - (a.market_cap ?? -1));
  } else if (key === "conviction") {
    // Strongest conviction first regardless of direction — a high-confidence 하락 is
    // as much of a headline as a high-confidence 상승, so this sorts on magnitude, not
    // signed score.
    copy.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  } else if (key === "probability") {
    copy.sort((a, b) => (probabilities(b)?.up ?? -1) - (probabilities(a)?.up ?? -1));
  } else if (key === "reliability") {
    copy.sort((a, b) => (b.reliability ?? -1) - (a.reliability ?? -1));
  } else if (key === "change") {
    copy.sort((a, b) => b.change_rate - a.change_rate);
  } else if (key === "accuracy") {
    // Stocks with no graded record sort last rather than to the top on a null — an
    // untested call is not a perfect one.
    copy.sort((a, b) => (b.accuracy?.recent20.rate ?? -1) - (a.accuracy?.recent20.rate ?? -1));
  } else {
    copy.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }
  return copy;
}

export default function AiPredictionPage() {
  const t = useT();
  useDocumentTitle("AI 종목예측 | K-Stock Hub");

  const [dates, setDates] = useState<PredictionDateOption[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [day, setDay] = useState<PredictionDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [market, setMarket] = useState<string>("ALL");
  const [sort, setSort] = useState<SortKey>("marketcap");
  const [hideUnreliable, setHideUnreliable] = useState(false);
  const [selected, setSelected] = useState<PredictionItem | null>(null);

  useEffect(() => {
    api
      .predictionDates()
      .then((res) => setDates(res.items))
      .catch(() => {
        // The navigator is an enhancement — the default (latest) day still loads
        // below, so a failed date list shouldn't surface as a page-level error.
      });
  }, []);

  // Holds the previous render while a new date is in flight, so switching dates
  // doesn't flash a skeleton and jump the layout — the old cards stay put at reduced
  // opacity until the new ones are ready.
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .predictions(selectedDate)
      .then((res) => {
        if (cancelled) return;
        setDay(res);
        hasLoadedOnce.current = true;
        if (!selectedDate && res.date) setSelectedDate(res.date);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || "예측 데이터를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  const groups = useMemo(() => {
    if (!day) return [];
    const filtered = market === "ALL" ? day.groups : day.groups.filter((g) => g.market === market);
    return filtered
      .map((g) => ({
        ...g,
        items: sortItems(
          hideUnreliable ? g.items.filter((i) => i.reliability_grade !== "낮음") : g.items,
          sort
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [day, market, sort, hideUnreliable]);

  const totals = useMemo(() => {
    const items = groups.flatMap((g) => g.items);
    const up = items.filter((i) => i.result === "상승").length;
    const down = items.filter((i) => i.result === "하락").length;
    const strong = items.filter((i) => i.confidence === "강").length;
    const avg = items.length ? items.reduce((sum, i) => sum + i.change_rate, 0) / items.length : 0;

    const reliabilities = items.map((i) => i.reliability).filter((r): r is number => r !== null);
    const avgReliability = reliabilities.length
      ? Math.round(reliabilities.reduce((s, r) => s + r, 0) / reliabilities.length)
      : null;
    const lowCount = items.filter((i) => i.reliability_grade === "낮음").length;

    const ups = items.map((i) => probabilities(i)?.up).filter((p): p is number => p !== undefined);
    const avgUpProb = ups.length ? Math.round(ups.reduce((s, p) => s + p, 0) / ups.length) : null;

    const graded = items.filter((i) => i.hit !== null);
    const hit = graded.filter((i) => i.hit).length;

    return {
      total: items.length,
      up,
      down,
      flat: items.length - up - down,
      strong,
      avg,
      avgReliability,
      lowCount,
      avgUpProb,
      graded: graded.length,
      hit,
    };
  }, [groups]);

  /** Markets that have no rows on the selected date, paired with the newest date that
   * does have them.
   *
   * This is the normal state, not an error: the KR batch runs after the 15:30 KST close
   * and predicts the next KRX session, while the US batch runs after the 16:00 ET close
   * — which is the following morning in Korea — so for most of the day the newest
   * Korean prediction targets a later 예측일자 than the newest American one. Showing a
   * single day at a time is right, but it has to point at where the other region went
   * rather than let it silently disappear. */
  const elsewhere = useMemo(() => {
    if (!day) return [];
    const present = new Set(day.groups.map((g) => g.market));
    const seen = new Set<string>();
    const out: { market: string; label: string; date: PredictionDateOption }[] = [];
    // `dates` is newest-first, so the first date carrying a missing market is that
    // market's most recent prediction.
    for (const d of dates) {
      for (const m of d.markets ?? []) {
        if (present.has(m) || seen.has(m)) continue;
        seen.add(m);
        out.push({ market: m, label: MARKET_LABELS[m] ?? m, date: d });
      }
    }
    return out;
  }, [day, dates]);

  const dateIndex = dates.findIndex((d) => d.date === (day?.date ?? selectedDate));
  // `dates` is newest-first, so "older" is a higher index and "newer" is a lower one.
  const olderDate = dateIndex >= 0 ? dates[dateIndex + 1] : undefined;
  const newerDate = dateIndex > 0 ? dates[dateIndex - 1] : undefined;

  // The countdown targets the earliest-opening market that actually has rows on this
  // date — on a normal weekday both batches land on the same session, but around a
  // weekend the Korean and US predictions target different days, and the hero should
  // count down to whichever one this page is showing.
  const countdownMarket = day?.groups[0]?.market ?? null;
  const showSkeleton = loading && !hasLoadedOnce.current;
  // A fully graded day is history, not a forecast: the countdown and the "expires at
  // the open" framing are meaningless there, and the page leads with the outcome
  // instead.
  const isSettled = totals.total > 0 && totals.graded === totals.total;
  const unreliableTotal = day?.groups.reduce((sum, g) => sum + g.summary.low_reliability, 0) ?? 0;

  return (
    <div className="app app--prediction">
      <header className="app-header">
        <div className="app-title-row">
          <div className="app-brand">
            <Link to="/" aria-label="K-Stock Hub">
              <Logo className="app-logo-wide" />
            </Link>
          </div>
          <div className="app-header-meta">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
        <div className="app-nav-row">
          <Link to="/map" className="kospi-map-nav-link">
            <MarketIcon /> KOSPI
          </Link>
          <Link to="/kosdaq-map" className="kospi-map-nav-link kospi-map-nav-link--kosdaq">
            <MarketIcon /> KOSDAQ
          </Link>
          <Link to="/fight" className="kospi-map-nav-link kospi-map-nav-link--battle">
            <BattleIcon /> {t("시총대결")}
          </Link>
          <Link to="/news" className="kospi-map-nav-link kospi-map-nav-link--news">
            <GlobalNewsIcon /> NEWS
          </Link>
          <VisitorBadge />
        </div>
      </header>

      <section className="pred-hero" aria-labelledby="pred-hero-title">
        <span className="pred-hero-aurora" aria-hidden="true" />
        <div className="pred-hero-inner">
          <span className="pred-hero-badge">
            <span className="pred-hero-badge-dot" aria-hidden="true" />
            AI 종목예측
          </span>
          <h1 id="pred-hero-title" className="pred-hero-title">
            {day?.date ? (
              <>
                <span className="pred-hero-date">{formatFullDate(day.date)}</span>
                <span className="pred-hero-weekday">{day.weekday}요일</span>
              </>
            ) : (
              "예측 데이터 준비 중"
            )}
          </h1>
          <p className="pred-hero-sub">
            방향 확률 · 신뢰도 · 장 마감 설명 · 근거 데이터 · 적중률을 함께 기록합니다
            {/* Inline rather than a separate line: the caveat belongs beside the claim
                it qualifies, not below it where a reader can take in the promise and
                scroll past the qualification. Wraps under on narrow viewports. */}
            <span className="pred-hero-caution">
              (AI 종목 예측은 실제 결과와 다를 수 있으니 참고 용도로만 봐주세요)
            </span>
          </p>
          {day?.date && countdownMarket && !isSettled ? (
            <OpenCountdown isoDate={day.iso} market={countdownMarket} />
          ) : null}
          {isSettled ? (
            <div className="pred-settled">
              <span className="pred-settled-mark" aria-hidden="true">
                ✓
              </span>
              채점 완료 · {totals.total}종목 중 {totals.hit}종목 적중 (
              {Math.round((totals.hit / totals.total) * 100)}%)
            </div>
          ) : null}
          {day ? <Scoreboard day={day} /> : null}
          {day?.generated_at ? (
            <p className="pred-hero-generated">분석 완료 {formatGeneratedAt(day.generated_at)} (KST)</p>
          ) : null}
        </div>
      </section>

      {/* One filter row above everything it scopes — date, market, sort and the
          reliability filter all re-render the same slice rather than each card
          carrying its own control. */}
      <div className="pred-controls">
        <div className="pred-datenav">
          <button
            type="button"
            className="pred-datenav-arrow"
            onClick={() => olderDate && setSelectedDate(olderDate.date)}
            disabled={!olderDate}
            aria-label="이전 예측일자"
          >
            ‹
          </button>
          <div className="pred-datenav-chips" role="tablist" aria-label="예측일자 선택">
            {dates.slice(0, 10).map((d) => (
              <button
                key={d.date}
                type="button"
                role="tab"
                aria-selected={d.date === day?.date}
                className={`pred-datechip${d.date === day?.date ? " is-active" : ""}`}
                onClick={() => setSelectedDate(d.date)}
              >
                <span className="pred-datechip-day">{Number(d.date.slice(6, 8))}</span>
                <span className="pred-datechip-weekday">{d.weekday}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="pred-datenav-arrow"
            onClick={() => newerDate && setSelectedDate(newerDate.date)}
            disabled={!newerDate}
            aria-label="다음 예측일자"
          >
            ›
          </button>
        </div>

        <div className="pred-filter-row">
          <div className="pred-tabs" role="tablist" aria-label="시장 선택">
            {[
              { key: "ALL", label: "전체" },
              ...(day?.groups ?? []).map((g) => ({ key: g.market, label: g.label })),
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={market === tab.key}
                className={`pred-tab${market === tab.key ? " is-active" : ""}`}
                onClick={() => setMarket(tab.key)}
              >
                {tab.label}
              </button>
            ))}
            {/* A market with no rows on this date still gets a tab, because otherwise
                it simply vanishes and reads as "the batch never ran". Clicking it jumps
                to the date where that market's newest prediction actually is. */}
            {elsewhere.map((m) => (
              <button
                key={m.market}
                type="button"
                className="pred-tab pred-tab--elsewhere"
                onClick={() => {
                  setMarket("ALL");
                  setSelectedDate(m.date.date);
                }}
                title={`${m.label} 예측은 ${m.date.label}자에 있습니다`}
              >
                {m.label}
                <span className="pred-tab-elsewhere-date">{m.date.label}</span>
              </button>
            ))}
          </div>
          <div className="pred-filter-tools">
            {unreliableTotal > 0 ? (
              <button
                type="button"
                className={`pred-toggle${hideUnreliable ? " is-active" : ""}`}
                aria-pressed={hideUnreliable}
                onClick={() => setHideUnreliable((v) => !v)}
              >
                신뢰도 낮음 {unreliableTotal}건 숨기기
              </button>
            ) : null}
            <label className="pred-sort">
              <span className="sr-only">정렬 기준</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {elsewhere.length ? (
          <p className="pred-elsewhere">
            {elsewhere.map((m) => (
              <button
                key={m.market}
                type="button"
                className="pred-elsewhere-link"
                onClick={() => {
                  setMarket("ALL");
                  setSelectedDate(m.date.date);
                }}
              >
                {m.label} 예측은 <b>{m.date.label}</b>자에 있습니다 <span aria-hidden="true">→</span>
              </button>
            ))}
            <span className="pred-elsewhere-why">
              한국장은 15:30 KST, 미국장은 16:00 ET에 마감해 두 배치의 예측일자가 서로 다릅니다.
            </span>
          </p>
        ) : null}
      </div>

      {error ? <p className="pred-error">{error}</p> : null}

      {!error && !showSkeleton && totals.total > 0 ? (
        <div className="pred-stats">
          <StatTile label="분석 종목" value={`${totals.total}종목`} hint={`강한 확신 ${totals.strong}건`} />
          <StatTile label="방향 분포" hint={`상승 ${totals.up} · 보합 ${totals.flat} · 하락 ${totals.down}`}>
            {/* The same encoding as a card's probability bar, one level up: the shape of
                the day at a glance, in the colours the cards use. */}
            <span className="pred-stat-dist" aria-hidden="true">
              {(
                [
                  ["up", totals.up],
                  ["flat", totals.flat],
                  ["down", totals.down],
                ] as const
              ).map(([tone, count]) => (
                <span
                  key={tone}
                  className={`pred-stat-dist-seg pred-stat-dist-seg--${tone}`}
                  style={{ width: `${(count / totals.total) * 100}%` }}
                />
              ))}
            </span>
          </StatTile>
          <StatTile
            label="평균 예상 등락률"
            value={formatChangeRate(totals.avg)}
            tone={totals.avg > 0 ? "up" : totals.avg < 0 ? "down" : "flat"}
            hint={totals.avgUpProb !== null ? `평균 상승 확률 ${totals.avgUpProb}%` : undefined}
          />
          <StatTile
            label="평균 신뢰도"
            value={totals.avgReliability !== null ? `${totals.avgReliability}점` : "―"}
            hint={totals.lowCount > 0 ? `신뢰도 낮음 ${totals.lowCount}종목` : "전 종목 신뢰도 보통 이상"}
          />
          <StatTile
            label={isSettled ? "이 날짜 적중률" : "채점 현황"}
            value={
              totals.graded > 0 ? `${Math.round((totals.hit / totals.graded) * 100)}%` : "채점 전"
            }
            tone={
              totals.graded > 0
                ? totals.hit / totals.graded >= 0.6
                  ? "up"
                  : totals.hit / totals.graded < 0.4
                    ? "down"
                    : "flat"
                : undefined
            }
            hint={
              totals.graded > 0
                ? `${totals.graded}종목 채점 · ${totals.hit}종목 적중`
                : "장 마감 후 다음 배치에서 채점됩니다"
            }
          />
        </div>
      ) : null}

      <main className={`pred-body${loading && hasLoadedOnce.current ? " is-refreshing" : ""}`}>
        {showSkeleton ? (
          <div className="pred-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : null}

        {!showSkeleton && !error && groups.length === 0 ? (
          <p className="pred-empty">
            {hideUnreliable && (day?.count ?? 0) > 0
              ? "신뢰도 낮음을 숨기면 표시할 종목이 없습니다. 필터를 해제해 보세요."
              : "선택한 날짜에 예측 데이터가 없습니다. 배치는 한국장 마감 직후와 뉴욕장 마감 직후에 각각 실행됩니다."}
          </p>
        ) : null}

        {groups.map((group) => (
          <section key={group.market} className="pred-group" aria-labelledby={`pred-group-${group.market}`}>
            <div className="pred-group-head">
              <h2 id={`pred-group-${group.market}`} className="pred-group-title">
                {group.label}
                <span className="pred-group-count">{group.items.length}종목</span>
              </h2>
              <div className="pred-group-summary">
                <span className="pred-group-chip pred-group-chip--up">상승 {group.summary.up}</span>
                <span className="pred-group-chip pred-group-chip--down">하락 {group.summary.down}</span>
                <span className="pred-group-chip pred-group-chip--flat">보합 {group.summary.flat}</span>
                <span className="pred-group-avg">
                  평균 {formatChangeRate(group.summary.avg_change_rate)}
                </span>
                {group.summary.avg_reliability !== null ? (
                  <span className="pred-group-avg">신뢰도 {group.summary.avg_reliability}</span>
                ) : null}
                {group.summary.graded > 0 ? (
                  <span
                    className={`pred-group-chip pred-group-chip--${
                      group.summary.hit / group.summary.graded >= 0.5 ? "hit" : "miss"
                    }`}
                  >
                    적중 {group.summary.hit}/{group.summary.graded}
                  </span>
                ) : null}
                {group.items[0] ? (
                  <span className="pred-group-collect">
                    수집 {formatFullDate(group.items[0].collect_date)}
                  </span>
                ) : null}
              </div>
            </div>
            <MarketContext items={group.items} />
            <div className="pred-grid">
              {group.items.map((item, i) => (
                <PredictionCard key={item.code} item={item} index={i} onOpen={setSelected} />
              ))}
            </div>
          </section>
        ))}
      </main>

      {selected ? <PredictionDetailModal item={selected} onClose={() => setSelected(null)} /> : null}

      <Footer />
    </div>
  );
}
