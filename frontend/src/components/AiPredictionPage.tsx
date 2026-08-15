import { useEffect, useMemo, useRef, useState } from "react";
import {
  PredictionAccuracy,
  PredictionDateOption,
  PredictionDay,
  PredictionItem,
  SessionScore,
  api,
} from "../api/client";
import { useT } from "../i18n/LanguageContext";
import {
  RELIABILITY_CLASS,
  RESULT_ARROW,
  RESULT_CLASS,
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
import EtfNavLink from "./EtfNavLink";
import GlobalNewsIcon from "./GlobalNewsIcon";
import GlobeRankIcon from "./GlobeRankIcon";
import LanguageToggle from "./LanguageToggle";
import DashboardIcon from "./DashboardIcon";
import Logo from "./Logo";
import MarketIcon from "./MarketIcon";
import PredictionCard from "./PredictionCard";
import PredictionDetailModal from "./PredictionDetailModal";
import RankIcon from "./RankIcon";
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

// Fixed display order for the per-market accuracy cards — matches the market tab
// strip below, so the two don't disagree about reading order.
const MARKET_ORDER = ["KOSPI", "KOSDAQ", "NASDAQ"];

/* How much of a market group is on screen before it asks.
 *
 * Each group is a market-cap top 30 now, and three of them is ninety cards — a scroll
 * long enough that the second market may as well not exist, and long enough that the
 * page's own controls are a page-up away by the time anyone reaches the third. Twelve
 * is four rows of the widest grid and two of the narrowest: enough that the cut is
 * plainly a fold rather than the end of the data, and the button under it says exactly
 * how much is behind it. */
const GROUP_PAGE = 12;

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

  // The label is part of the sentence, so it changes with the state rather than
  // staying fixed while only the value swaps: "…개장까지" is the opening half of a
  // countdown and reads as a fragment once there is nothing left to count, which is
  // how it came out as "한국 증시 개장까지 / 장이 시작되었습니다". The market name
  // stays in both states because this page shows KR and US sessions side by side.
  return (
    <div className="pred-countdown">
      {remaining ? (
        <>
          <span className="pred-countdown-label">{marketOpenLabel(market)} 개장까지</span>
          <span className="pred-countdown-value">{remaining}</span>
        </>
      ) : (
        <>
          <span className="pred-countdown-label">{marketOpenLabel(market)}</span>
          <span className="pred-countdown-value pred-countdown-value--open">
            장이 시작되었습니다
          </span>
        </>
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

/** One market's column in the header scoreboard: its last graded session, its
 * trailing-20 rate, and a bar per recent session behind them. */
function MarketScoreCard({ label, sessions }: { label: string; sessions: SessionScore[] }) {
  const latest = sessions[0] ?? null;
  const recent = rollup(sessions, 20);

  return (
    <div className="pred-market-score">
      <span className="pred-market-score-label">{label}</span>
      <div className="pred-market-score-body">
        {latest ? (
          <div
            className={`pred-score-headline pred-score-headline--${
              latest.rate !== null && latest.rate >= 50 ? "good" : "bad"
            }`}
          >
            <span className="pred-score-label">직전 {formatFullDate(latest.predict_date).slice(5)}</span>
            <span className="pred-score-value">
              {latest.rate}
              <small>%</small>
            </span>
            <span className="pred-score-hint">
              {latest.total}종목 중 {latest.hit}종목 적중
            </span>
          </div>
        ) : (
          <div className="pred-score-headline">
            <span className="pred-score-label">채점 이력 없음</span>
          </div>
        )}

        {recent.rate !== null ? (
          <div className="pred-score-aggregate">
            <span className="pred-score-label">최근 20거래일</span>
            <span className={`pred-score-agg-value pred-score-agg-value--${accuracyTone({ ...recent })}`}>
              {recent.rate}%
            </span>
            <span className="pred-score-hint">
              {recent.total}건 중 {recent.hit}건 적중
            </span>
          </div>
        ) : null}
      </div>

      {sessions.length > 1 ? (
        <div className="pred-score-spark" role="img" aria-label={`${label} 최근 채점된 예측일자별 적중률`}>
          {/* Oldest on the left so the series reads left-to-right like every other
              time axis on the site; the API returns it newest-first. */}
          {[...sessions].slice(0, 14).reverse().map((s) => (
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

/** The page's trust anchor, directly under the title: how each market's last checked
 * session actually turned out, kept apart rather than pooled into one number — KOSPI,
 * KOSDAQ and NASDAQ grade on independent calendars and can be having very different
 * runs at the same moment, and a single blended rate would hide exactly that.
 *
 * It sits above the forecasts rather than below them on purpose. A prediction page
 * that shows its track record only after you scroll is asking to be believed first and
 * audited later; this asks to be audited first.
 */
function Scoreboard({ accuracy }: { accuracy: PredictionAccuracy }) {
  const markets = MARKET_ORDER.filter((m) => accuracy.sessions_by_market[m]?.length);
  if (!markets.length) return null;

  return (
    <div className="pred-scoreboard pred-scoreboard--markets">
      {markets.map((m) => (
        <MarketScoreCard key={m} label={MARKET_LABELS[m] ?? m} sessions={accuracy.sessions_by_market[m]} />
      ))}
    </div>
  );
}

/** What the day's forecasts add up to, as one dial.
 *
 * The page had five stat tiles and no single object to look at, which is the shape of
 * a spreadsheet rather than of a result. A forecast page's headline is not a table of
 * averages — it is "which way, and how sure", and that is two numbers that belong in
 * one mark.
 *
 * The ring is the direction split: 상승 / 보합 / 하락 as three arcs of one circle, in
 * the same three colours the cards and the probability bars use, so the dial and the
 * grid below it are visibly the same encoding at two scales. The figure inside is the
 * mean 상승확률, which is the model's own answer rather than a count of verdicts.
 *
 * Nothing here is reachable only by colour: every arc's share is printed in the legend
 * beside it, and the aria-label states the whole split as a sentence.
 */
function SignalDial({
  up,
  flat,
  down,
  total,
  avgUpProb,
  avgReliability,
}: {
  up: number;
  flat: number;
  down: number;
  total: number;
  avgUpProb: number | null;
  avgReliability: number | null;
}) {
  if (!total) return null;

  const upPct = (up / total) * 100;
  const flatPct = (flat / total) * 100;
  // The headline figure. The mean probability when the rows carry one; otherwise the
  // share of 상승 verdicts, which is the same question answered more coarsely.
  const headline = avgUpProb ?? Math.round(upPct);
  const lean = up > down ? "up" : down > up ? "down" : "flat";

  return (
    <div className="pred-dial-wrap">
      <div
        className={`pred-dial pred-dial--${lean}`}
        style={{
          // Two stops define three arcs. Written as custom properties rather than an
          // inline conic-gradient so the whole gradient — including the colours, which
          // are theme tokens — stays in the stylesheet.
          ["--seg-up" as string]: `${upPct}%`,
          ["--seg-flat" as string]: `${upPct + flatPct}%`,
        }}
        role="img"
        aria-label={`분석 ${total}종목의 방향 분포: 상승 ${up}종목, 보합 ${flat}종목, 하락 ${down}종목. 평균 상승확률 ${headline}%.`}
      >
        {/* The slow sweep. One rotating conic wedge at low alpha — the only motion in
            the dial, and the thing that makes it read as an instrument that is running
            rather than a pie chart that was printed. */}
        <span className="pred-dial-sweep" aria-hidden="true" />
        <span className="pred-dial-core">
          <span className="pred-dial-value">
            {headline}
            <small>%</small>
          </span>
          <span className="pred-dial-caption">평균 상승확률</span>
        </span>
      </div>

      <ul className="pred-dial-legend">
        {(
          [
            ["up", "상승", up],
            ["flat", "보합", flat],
            ["down", "하락", down],
          ] as const
        ).map(([tone, label, count]) => (
          <li key={tone} className={`pred-dial-key pred-dial-key--${tone}`}>
            <span className="pred-dial-key-dot" aria-hidden="true" />
            <span className="pred-dial-key-label">{label}</span>
            <b>{count}</b>
          </li>
        ))}
      </ul>

      {avgReliability !== null ? (
        <div className="pred-dial-meter">
          <span className="pred-dial-meter-label">평균 신뢰도</span>
          <span className="pred-dial-meter-track" aria-hidden="true">
            <span className="pred-dial-meter-fill" style={{ width: `${avgReliability}%` }} />
          </span>
          <b className="pred-dial-meter-value">{avgReliability}</b>
        </div>
      ) : null}
    </div>
  );
}

/** The three calls the model leaned hardest on, lifted out of the grid.
 *
 * A twenty-card grid sorted by market cap opens on 삼성전자 every single day, whatever
 * the model actually found — the most interesting rows are wherever conviction happens
 * to be highest, which on a market-cap ordering is nowhere in particular. This is the
 * page answering "what did the AI actually find today" before asking anyone to scan.
 *
 * Sorted on |score|, not on signed score: a high-conviction 하락 is as much of a
 * finding as a high-conviction 상승, and ranking on the signed value would quietly turn
 * the strip into a buy list.
 *
 * It respects the filters above it. A reader who has narrowed to KOSDAQ is asking what
 * the model found in KOSDAQ, and a strip that kept answering with the whole market
 * would be answering a question nobody asked.
 */
function TopSignals({
  items,
  onOpen,
}: {
  items: PredictionItem[];
  onOpen: (item: PredictionItem) => void;
}) {
  const picks = useMemo(
    () => [...items].sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 3),
    [items]
  );
  if (picks.length < 2) return null;

  return (
    <section className="pred-top" aria-labelledby="pred-top-title">
      <div className="pred-top-head">
        <h2 id="pred-top-title" className="pred-top-title">
          <span className="pred-top-title-mark" aria-hidden="true" />
          AI가 가장 확신한 종목
        </h2>
        <p className="pred-top-sub">확신도 순 · 카드를 누르면 판단 근거 전체가 열립니다</p>
      </div>
      <div className="pred-top-row">
        {picks.map((item, i) => {
          const tone = RESULT_CLASS[item.result];
          const probs = probabilities(item);
          return (
            <button
              key={item.code}
              type="button"
              className={`pred-top-card pred-top-card--${tone}`}
              style={{ animationDelay: `${i * 90}ms` }}
              onClick={() => onOpen(item)}
              aria-label={`확신도 ${i + 1}위 ${item.name}, 익일 ${item.result} 예측 ${formatChangeRate(
                item.change_rate
              )}. 상세 보기`}
            >
              <span className="pred-top-glow" aria-hidden="true" />
              <span className="pred-top-rank" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="pred-top-body">
                <span className="pred-top-name">{item.name}</span>
                <span className="pred-top-meta">
                  {item.market} · {item.code}
                </span>
                <span className="pred-top-figure">
                  <span className={`pred-top-arrow pred-top-arrow--${tone}`} aria-hidden="true">
                    {RESULT_ARROW[item.result]}
                  </span>
                  <span className={`pred-top-change pred-top-change--${tone}`}>
                    {formatChangeRate(item.change_rate)}
                  </span>
                  <span className="pred-top-verdict">{item.result}</span>
                </span>
                {probs ? (
                  <span className="pred-top-bar" aria-hidden="true">
                    <span className="pred-top-bar-seg pred-top-bar-seg--up" style={{ width: `${probs.up}%` }} />
                    <span className="pred-top-bar-seg pred-top-bar-seg--flat" style={{ width: `${probs.flat}%` }} />
                    <span className="pred-top-bar-seg pred-top-bar-seg--down" style={{ width: `${probs.down}%` }} />
                  </span>
                ) : null}
                <span className="pred-top-foot">
                  {probs ? <b>상승확률 {probs.up}%</b> : <b>확신도 {item.confidence}</b>}
                  {item.reliability_grade ? <span>신뢰도 {item.reliability_grade}</span> : null}
                  <span className="pred-top-cta">
                    근거 {item.evidence.length}건 <span aria-hidden="true">›</span>
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The same day, as rows.
 *
 * Thirty cards of one market are thirty separate little layouts, and comparing the
 * seventh's 상승확률 against the twenty-second's means finding the same graphic twice
 * in two different places on screen. A row puts every number in a column, which is the
 * only arrangement in which thirty of anything are actually comparable.
 *
 * It carries the same facts as a card, not fewer: rank, verdict, target, expected
 * move, the three probabilities, reliability, and the graded outcome where there is
 * one. What it drops is the card's prose — the 장 마감 설명 — which is a paragraph, and
 * a paragraph is what the modal behind every row is for.
 */
function PredictionRows({
  items,
  rankByCode,
  onOpen,
}: {
  items: PredictionItem[];
  rankByCode: Map<string, number>;
  onOpen: (item: PredictionItem) => void;
}) {
  return (
    <div className="pred-rows">
      {/* Column names, and nothing more than that to a screen reader: each row below
          is a button that states its own contents in its label, so announcing these
          again per row would triple the length of every one of thirty rows. Grid
          roles are deliberately not used — the rows are controls first, and a button
          that claims to be a table cell stops being announced as pressable. */}
      <div className="pred-row pred-row--head" aria-hidden="true">
        <span>순위</span>
        <span>종목</span>
        <span>예측</span>
        <span>예상 등락</span>
        <span>방향 확률</span>
        <span>신뢰도</span>
        <span />
      </div>
      {items.map((item) => {
        const tone = RESULT_CLASS[item.result];
        const probs = probabilities(item);
        const rank = rankByCode.get(item.code);
        return (
          <button
            key={item.code}
            type="button"
            className={`pred-row pred-row--${tone}${
              item.hit === null ? "" : ` pred-row--${item.hit ? "hit" : "miss"}`
            }`}
            onClick={() => onOpen(item)}
            aria-label={`${item.name} 익일 ${item.result} 예측 ${formatChangeRate(item.change_rate)}. 상세 보기`}
          >
            <span className="pred-row-rank">{rank ?? "―"}</span>
            <span className="pred-row-name">
              <b>{item.name}</b>
              <small>{item.code}</small>
            </span>
            <span className={`pred-row-verdict pred-row-verdict--${tone}`}>
              <span aria-hidden="true">{RESULT_ARROW[item.result]}</span>
              {item.result}
            </span>
            <span className={`pred-row-change pred-row-change--${tone}`}>
              {formatChangeRate(item.change_rate)}
            </span>
            <span className="pred-row-prob">
              {probs ? (
                <>
                  <span className="pred-row-bar" aria-hidden="true">
                    <span className="pred-top-bar-seg pred-top-bar-seg--up" style={{ width: `${probs.up}%` }} />
                    <span className="pred-top-bar-seg pred-top-bar-seg--flat" style={{ width: `${probs.flat}%` }} />
                    <span className="pred-top-bar-seg pred-top-bar-seg--down" style={{ width: `${probs.down}%` }} />
                  </span>
                  <span className="pred-row-prob-num">{probs.up}%</span>
                </>
              ) : (
                <span className="pred-row-prob-num">―</span>
              )}
            </span>
            <span className="pred-row-rel">
              {item.reliability_grade ? (
                <span className={`pred-chip pred-chip--${RELIABILITY_CLASS[item.reliability_grade]}`}>
                  {item.reliability_grade}
                  {item.reliability !== null ? ` ${item.reliability}` : ""}
                </span>
              ) : (
                "―"
              )}
            </span>
            <span className="pred-row-go" aria-hidden="true">
              {item.hit === null ? "›" : item.hit ? "적중" : "빗나감"}
            </span>
          </button>
        );
      })}
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
  const [accuracy, setAccuracy] = useState<PredictionAccuracy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [market, setMarket] = useState<string>("ALL");
  const [sort, setSort] = useState<SortKey>("marketcap");
  const [hideUnreliable, setHideUnreliable] = useState(false);
  const [selected, setSelected] = useState<PredictionItem | null>(null);
  /* Free-text narrowing over name and code. Not a feature the ten-name roster needed —
     with ninety it is the difference between "is 카카오 in here" being a question you
     answer by looking and one you answer by scrolling three market groups. */
  const [query, setQuery] = useState("");
  /* 카드 / 리스트. The card grid is the page's identity and stays the default; the list
     is what thirty rows of one market are actually comparable in, since it puts every
     number in the same column instead of in the same place on ninety separate cards.
     Remembered, because it is a reading preference rather than a per-visit choice. */
  const [dense, setDense] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("pred:view") === "list";
    } catch {
      // Private mode, storage disabled — the preference is a nicety, not a dependency.
      return false;
    }
  });
  /* Which groups the reader has opened past the fold. A market group now holds thirty
     cards, and three of them stacked is a ninety-card scroll before anything else on
     the page is reachable — so each group shows a screenful and says how many more it
     has. Keyed by market, so opening KOSPI doesn't also open NASDAQ. */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      window.localStorage.setItem("pred:view", dense ? "list" : "card");
    } catch {
      // As above.
    }
  }, [dense]);

  useEffect(() => {
    // Independent of the date navigator — this is each market's own trailing record,
    // not a property of whichever session happens to be on screen.
    api
      .predictionAccuracy()
      .then((res) => setAccuracy(res))
      .catch(() => {
        // The header cards are an enhancement over the per-card track records shown
        // further down; a failed fetch here shouldn't block the rest of the page.
      });
  }, []);

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

  /* 시가총액 순위, computed once per day rather than read off display order.
   *
   * The roster IS the market-cap top 30, so a row's rank inside its group is a real
   * fact about it — 1위 삼성전자, 17위 whoever — and printing it is what turns a wall
   * of ninety cards back into a list a reader has a map of. It has to come from the
   * cap ordering and not from the rendered order, because the rendered order is
   * whatever the sort control says: sort by 확신도 and the third card can perfectly
   * well be the market's largest company. */
  const rankByCode = useMemo(() => {
    const ranks = new Map<string, number>();
    for (const group of day?.groups ?? []) {
      [...group.items]
        .sort((a, b) => (b.market_cap ?? -1) - (a.market_cap ?? -1))
        .forEach((item, i) => ranks.set(item.code, i + 1));
    }
    return ranks;
  }, [day]);

  const groups = useMemo(() => {
    if (!day) return [];
    const needle = query.trim().toLowerCase();
    const filtered = market === "ALL" ? day.groups : day.groups.filter((g) => g.market === market);
    return filtered
      .map((g) => {
        let items = hideUnreliable ? g.items.filter((i) => i.reliability_grade !== "낮음") : g.items;
        if (needle) {
          // Code as well as name: a US ticker is what a reader types, and a KRX code is
          // what they paste out of another screen.
          items = items.filter(
            (i) => i.name.toLowerCase().includes(needle) || i.code.toLowerCase().includes(needle)
          );
        }
        return { ...g, items: sortItems(items, sort) };
      })
      .filter((g) => g.items.length > 0);
  }, [day, market, sort, hideUnreliable, query]);

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

  /* ← / → step through 예측일자.
   *
   * The date strip is the control this page is used through — every other filter
   * narrows one day, this one changes which day — and reaching for two small arrows
   * at the end of a scrolling chip row is the slowest way to work it. The arrows and
   * the chips stay exactly as they were; this is a shortcut over them, not a
   * replacement, and the hint under the strip is what stops it being a secret.
   *
   * Ignored while the focus is in a field or on a control that uses the same keys
   * itself — the sort <select> is one, and stealing → from it would break choosing a
   * sort option with the keyboard. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }
      // ← is older, → is newer: the strip runs oldest-left like every other time axis
      // on this site, so the arrows move along it rather than along the array, which
      // is newest-first.
      const next = event.key === "ArrowLeft" ? olderDate : newerDate;
      if (!next) return;
      event.preventDefault();
      setSelectedDate(next.date);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [olderDate, newerDate]);

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
          <Link to="/desk" className="kospi-map-nav-link kospi-map-nav-link--home">
            <DashboardIcon /> {t("홈")}
          </Link>
          <Link to="/market-brief" className="kospi-map-nav-link kospi-map-nav-link--brief">장 마감 리포트</Link>
          <Link to="/map" className="kospi-map-nav-link">
            <MarketIcon /> KOSPI
          </Link>
          <Link to="/kosdaq-map" className="kospi-map-nav-link kospi-map-nav-link--kosdaq">
            <MarketIcon /> KOSDAQ
          </Link>
          {/* This row has no NASDAQ100 link to sit after (unlike the map/dashboard
              rows), so TOP 100 closes the market-destination block instead. */}
          <EtfNavLink />
          <Link to="/kospi-100" className="kospi-map-nav-link kospi-map-nav-link--top100">
            <RankIcon /> TOP 100
          </Link>
          <Link to="/global-top100" className="kospi-map-nav-link kospi-map-nav-link--globaltop100">
            <GlobeRankIcon /> {t("글로벌 시총")}
          </Link>
          <Link to="/fight" className="kospi-map-nav-link kospi-map-nav-link--battle">
            <BattleIcon /> {t("시총대결")}
          </Link>
          <Link to="/news" className="kospi-map-nav-link kospi-map-nav-link--news">
            <GlobalNewsIcon /> NEWS
          </Link>
          <Link to="/ai-prediction/grading" className="kospi-map-nav-link">
            채점 결과 매트릭스
          </Link>
          <VisitorBadge />
        </div>
      </header>

      {/* ── the console ──
          Two columns rather than one centred stack: the left side says what this is
          and when it expires, the right side says what it found. The old layout put
          the second of those in five equal tiles below the fold of a phone, which
          made the page's actual output the least prominent thing on it. */}
      <section className="pred-hero" aria-labelledby="pred-hero-title">
        <span className="pred-hero-aurora" aria-hidden="true" />
        <span className="pred-hero-grid" aria-hidden="true" />
        <div className="pred-hero-inner">
          <div className="pred-hero-main">
            <span className="pred-hero-badge">
              <span className="pred-hero-badge-dot" aria-hidden="true" />
              AI 종목예측
              <span className="pred-hero-badge-sep" aria-hidden="true" />
              <span className="pred-hero-badge-state">{isSettled ? "채점 완료" : "예측 진행중"}</span>
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
            <div className="pred-hero-status">
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
            </div>
            {day?.generated_at ? (
              <p className="pred-hero-generated">
                <span className="pred-hero-generated-mark" aria-hidden="true" />
                분석 완료 {formatGeneratedAt(day.generated_at)} (KST)
              </p>
            ) : null}
          </div>

          {/* The output side. Absent while the first day is still loading — a dial
              spun up on zeros would state a finding the page does not have yet. */}
          {totals.total > 0 ? (
            <SignalDial
              up={totals.up}
              flat={totals.flat}
              down={totals.down}
              total={totals.total}
              avgUpProb={totals.avgUpProb}
              avgReliability={totals.avgReliability}
            />
          ) : null}
        </div>

        {/* The track record, along the foot of the console rather than floating in
            the middle of it: it qualifies everything above, and it is the one block
            here a sceptical reader goes looking for. */}
        {accuracy ? <Scoreboard accuracy={accuracy} /> : null}

        <Link to="/ai-prediction/grading" className="pred-matrix-link">
          날짜 × 종목 채점 결과 매트릭스 보기 <span aria-hidden="true">→</span>
        </Link>
      </section>

      {!error && !showSkeleton ? <TopSignals items={groups.flatMap((g) => g.items)} onOpen={setSelected} /> : null}

      {/* One filter row above everything it scopes — date, market, sort and the
          reliability filter all re-render the same slice rather than each card
          carrying its own control. */}
      <div className="pred-controls">
        <div className="pred-controls-caption">
          <span className="pred-controls-caption-label">예측일자</span>
          {/* The shortcut, stated where the control it drives is. A keyboard
              affordance nobody is told about is a keyboard affordance nobody uses. */}
          <span className="pred-controls-hint" aria-hidden="true">
            <kbd>←</kbd>
            <kbd>→</kbd> 로 날짜 이동
          </span>
        </div>
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
            {/* Search first in the row because at ninety rows it is the tool most
                reached for. Type-to-filter with no submit: there is nothing to wait
                for, the whole day is already in memory. */}
            <label className="pred-search">
              <span className="sr-only">종목 검색</span>
              <span className="pred-search-icon" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="종목명 · 코드 검색"
                autoComplete="off"
              />
              {query ? (
                <button
                  type="button"
                  className="pred-search-clear"
                  onClick={() => setQuery("")}
                  aria-label="검색어 지우기"
                >
                  ×
                </button>
              ) : null}
            </label>
            {/* Card ↔ list. Two states, so a segmented pair rather than a menu — the
                alternative is always visible and one click away. */}
            <div className="pred-viewtoggle" role="group" aria-label="보기 방식">
              <button
                type="button"
                className={`pred-viewbtn${dense ? "" : " is-active"}`}
                aria-pressed={!dense}
                onClick={() => setDense(false)}
              >
                카드
              </button>
              <button
                type="button"
                className={`pred-viewbtn${dense ? " is-active" : ""}`}
                aria-pressed={dense}
                onClick={() => setDense(true)}
              >
                리스트
              </button>
            </div>
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
              : "선택한 날짜에 예측 데이터가 없습니다. 배치는 평일 밤 11시에 한국장·뉴욕장 각 현지시각으로 따로 실행됩니다."}
          </p>
        ) : null}

        {groups.map((group) => {
          /* Open past the fold when the reader asked, or when a filter has already cut
             the group down to something a screen holds. A "18종목 더 보기" button under
             a search that matched four rows would be a control that does nothing. */
          const isOpen = expanded[group.market] || group.items.length <= GROUP_PAGE;
          const shown = isOpen ? group.items : group.items.slice(0, GROUP_PAGE);
          const hidden = group.items.length - shown.length;
          const dist = group.summary.up + group.summary.flat + group.summary.down || 1;
          return (
          <section key={group.market} className="pred-group" aria-labelledby={`pred-group-${group.market}`}>
            <div className="pred-group-head">
              <h2 id={`pred-group-${group.market}`} className="pred-group-title">
                {group.label}
                <span className="pred-group-count">{group.items.length}종목</span>
                {/* The group's shape, as one bar beside its name. Three market groups
                    of thirty is more numbers than a reader will total in their head,
                    and this is the totalling done for them — same three colours as the
                    dial above and the cards below. */}
                <span
                  className="pred-group-dist"
                  role="img"
                  aria-label={`상승 ${group.summary.up}, 보합 ${group.summary.flat}, 하락 ${group.summary.down}`}
                >
                  <span className="pred-group-dist-seg pred-group-dist-seg--up" style={{ width: `${(group.summary.up / dist) * 100}%` }} />
                  <span className="pred-group-dist-seg pred-group-dist-seg--flat" style={{ width: `${(group.summary.flat / dist) * 100}%` }} />
                  <span className="pred-group-dist-seg pred-group-dist-seg--down" style={{ width: `${(group.summary.down / dist) * 100}%` }} />
                </span>
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
            {dense ? (
              <PredictionRows items={shown} rankByCode={rankByCode} onOpen={setSelected} />
            ) : (
              <div className="pred-grid">
                {shown.map((item, i) => (
                  <PredictionCard
                    key={item.code}
                    item={item}
                    index={i}
                    rank={rankByCode.get(item.code)}
                    onOpen={setSelected}
                  />
                ))}
              </div>
            )}
            {hidden > 0 ? (
              <button
                type="button"
                className="pred-more"
                onClick={() => setExpanded((prev) => ({ ...prev, [group.market]: true }))}
              >
                {group.label} 나머지 {hidden}종목 더 보기
                <span aria-hidden="true">↓</span>
              </button>
            ) : null}
            {/* Only when this group was actually opened by hand — a group short enough
                to be open on its own has nothing to collapse. */}
            {isOpen && expanded[group.market] ? (
              <button
                type="button"
                className="pred-more pred-more--less"
                onClick={() => setExpanded((prev) => ({ ...prev, [group.market]: false }))}
              >
                {group.label} 접기 <span aria-hidden="true">↑</span>
              </button>
            ) : null}
          </section>
          );
        })}
      </main>

      {selected ? <PredictionDetailModal item={selected} onClose={() => setSelected(null)} /> : null}

      <Footer />
    </div>
  );
}
