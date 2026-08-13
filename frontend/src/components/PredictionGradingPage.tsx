import { useEffect, useMemo, useState } from "react";
import { GradingMatrixResponse, PredictionItem, api } from "../api/client";
import { formatChangeRate, formatMoney } from "../prediction";
import { Link } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import DashboardIcon from "./DashboardIcon";
import Footer from "./Footer";
import EtfNavLink from "./EtfNavLink";
import LanguageToggle from "./LanguageToggle";
import Logo from "./Logo";
import PredictionDetailModal from "./PredictionDetailModal";
import ThemeToggle from "./ThemeToggle";

const MARKET_TABS = [
  { key: "ALL", label: "전체" },
  { key: "KOSPI", label: "코스피" },
  { key: "KOSDAQ", label: "코스닥" },
  { key: "NASDAQ", label: "나스닥" },
];

const LIMIT_OPTIONS = [20, 40, 60];

/** How the rows are ordered. Default is the API's own order (cap rank), because
 * that is the order a reader recognises the list in; the other two answer the
 * questions the page exists for. */
const SORTS = [
  { key: "rank", label: "기본 순서" },
  { key: "best", label: "적중률 높은 순" },
  { key: "worst", label: "적중률 낮은 순" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

/** A tally of graded calls. `pending` is deliberately outside the rate: a call
 * that has not traded yet is not a miss, and folding it in would drag every
 * fresh session's number toward zero for reasons that have nothing to do with
 * whether the model was right. */
interface Tally {
  hit: number;
  miss: number;
  pending: number;
}

const EMPTY_TALLY: Tally = { hit: 0, miss: 0, pending: 0 };

function addCell(tally: Tally, cell: Cell | undefined): Tally {
  if (!cell) return tally;
  if (cell.hit === null) return { ...tally, pending: tally.pending + 1 };
  return cell.hit
    ? { ...tally, hit: tally.hit + 1 }
    : { ...tally, miss: tally.miss + 1 };
}

/** Graded calls only. Null when nothing has been graded — which is a different
 * statement from 0%, and has to render differently. */
function rateOf(tally: Tally): number | null {
  const graded = tally.hit + tally.miss;
  return graded === 0 ? null : (tally.hit / graded) * 100;
}

/** The band a rate falls in. Three states rather than a gradient: this is a
 * batting average off a few dozen calls, and shading it continuously would imply
 * a precision the sample size does not support. */
function bandOf(rate: number | null): "none" | "low" | "mid" | "high" {
  if (rate === null) return "none";
  if (rate >= 60) return "high";
  if (rate >= 45) return "mid";
  return "low";
}

// The matrix's own date window tops out at 60 sessions; a stock's full history call
// is asked for at least that many rows so the clicked column is never older than what
// predictionHistory actually returns (see openCell below).
const HISTORY_FETCH_LIMIT = 90;

/** "20260727" -> "7/27" — the matrix header needs a column label narrow enough that
 * 20-60 of them still fit across a screen; the full "2026년 7월 27일" the rest of the
 * page uses would blow the column width out immediately. */
function shortDateLabel(dateKey: string): string {
  if (!/^\d{8}$/.test(dateKey)) return dateKey;
  return `${Number(dateKey.slice(4, 6))}/${Number(dateKey.slice(6, 8))}`;
}

type Cell = GradingMatrixResponse["rows"][number]["cells"][string];

/** One matrix cell: predicted price/rate on top, actual price/rate (or a pending
 * marker) below, tinted by hit/miss/pending so the grid still reads as a shape from a
 * distance even with the extra numbers. Clickable — it opens the same detail popup
 * the AI 예측 page uses, for the specific (종목, 예측일자) pair this cell represents. */
function MatrixCell({
  cell,
  market,
  busy,
  compact,
  onOpen,
}: {
  cell: Cell | undefined;
  market: string;
  busy: boolean;
  compact: boolean;
  onOpen: () => void;
}) {
  if (!cell) {
    return <td className="pred-matrix-cell pred-matrix-cell--empty" aria-label="예측 없음" />;
  }
  const state = cell.hit === null ? "pending" : cell.hit ? "hit" : "miss";
  const mark = busy ? "…" : state === "pending" ? "···" : state === "hit" ? "✓" : "✕";
  /* Compact keeps the mark and drops the four numbers. The detailed cell carries
     predicted price, predicted rate, actual price and actual rate, and at
     sixty columns that is a wall of digits nobody reads across — the grid was
     meant to be legible as a *shape*, which is precisely what four numbers per
     cell prevent. The numbers are one hover (or one click) away either way. */
  const title = `${state === "hit" ? "적중" : state === "miss" ? "실패" : "채점 대기"} · 예측 ${formatMoney(
    cell.predict_price,
    market
  )} ${formatChangeRate(cell.change_rate)}${
    cell.actual_price === null
      ? ""
      : ` · 실제 ${formatMoney(cell.actual_price, market)} ${formatChangeRate(cell.actual_change_rate ?? 0)}`
  }`;

  return (
    <td className={`pred-matrix-cell pred-matrix-cell--${state}`}>
      <button
        type="button"
        className="pred-matrix-cellbtn"
        disabled={busy}
        aria-busy={busy}
        onClick={onOpen}
        title={title}
      >
        <span className="pred-matrix-mark" aria-hidden="true">
          {mark}
        </span>
        {!compact && (
          <>
            <span className="pred-matrix-line pred-matrix-line--predict">
              예측 {formatMoney(cell.predict_price, market)}
              <em>{formatChangeRate(cell.change_rate)}</em>
            </span>
            <span className="pred-matrix-line pred-matrix-line--actual">
              {cell.hit === null || cell.actual_price === null ? (
                "채점 대기"
              ) : (
                <>
                  실제 {formatMoney(cell.actual_price, market)}
                  <em>{formatChangeRate(cell.actual_change_rate ?? 0)}</em>
                </>
              )}
            </span>
          </>
        )}
      </button>
    </td>
  );
}

/** A rate as a number and a bar. Used for the whole board, for each stock and
 * for each session, so the three are read on the same scale. */
function RateBar({ tally, size = "row" }: { tally: Tally; size?: "row" | "hero" }) {
  const rate = rateOf(tally);
  const graded = tally.hit + tally.miss;
  return (
    <span className={`pred-rate pred-rate--${size} is-${bandOf(rate)}`}>
      <span className="pred-rate-value">{rate === null ? "—" : `${Math.round(rate)}%`}</span>
      <span className="pred-rate-track" aria-hidden="true">
        <span className="pred-rate-fill" style={{ width: `${rate ?? 0}%` }} />
      </span>
      <span className="pred-rate-count">
        {graded === 0 ? "채점 전" : `${tally.hit}/${graded}`}
      </span>
    </span>
  );
}

export default function PredictionGradingPage() {
  useDocumentTitle("채점 결과 매트릭스 | K-Stock Hub");

  const [market, setMarket] = useState("ALL");
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState<SortKey>("rank");
  const [compact, setCompact] = useState(false);
  const [data, setData] = useState<GradingMatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<PredictionItem | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  // Tracks which (code, date) cell is mid-fetch so its button can show a busy state
  // rather than the whole page blocking for what is otherwise a per-cell popup.
  const [pendingCell, setPendingCell] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .predictionGradingMatrix(market === "ALL" ? null : market, limit)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || "채점 결과를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [market, limit]);

  // Newest session on the left, right next to the frozen 종목 column, so the latest
  // grading result is visible without scrolling. The API already returns dates
  // newest-first, so no reversal is needed.
  const dates = useMemo(() => data?.dates ?? [], [data]);

  const rawRows = useMemo(() => data?.rows ?? [], [data]);

  /* Everything below is counted from the same cells the grid draws, so the
     headline number and the grid can never disagree — there is no second source
     for either to drift against. */
  const perRow = useMemo(() => {
    const map = new Map<string, Tally>();
    for (const row of rawRows) {
      let tally = EMPTY_TALLY;
      for (const d of dates) tally = addCell(tally, row.cells[d.date]);
      map.set(row.code, tally);
    }
    return map;
  }, [rawRows, dates]);

  const perDate = useMemo(() => {
    const map = new Map<string, Tally>();
    for (const d of dates) {
      let tally = EMPTY_TALLY;
      for (const row of rawRows) tally = addCell(tally, row.cells[d.date]);
      map.set(d.date, tally);
    }
    return map;
  }, [rawRows, dates]);

  const total = useMemo(() => {
    let tally = EMPTY_TALLY;
    for (const t of perRow.values()) {
      tally = {
        hit: tally.hit + t.hit,
        miss: tally.miss + t.miss,
        pending: tally.pending + t.pending,
      };
    }
    return tally;
  }, [perRow]);

  /* The best and worst names on the board, over graded calls only and only when
     there are enough of them to mean anything — a stock with one graded call and
     one hit is not "the most accurate stock", it is a coin that landed once. */
  const extremes = useMemo(() => {
    const scored = rawRows
      .map((row) => ({ row, tally: perRow.get(row.code) ?? EMPTY_TALLY }))
      .filter(({ tally }) => tally.hit + tally.miss >= 5)
      .map(({ row, tally }) => ({ row, rate: rateOf(tally) ?? 0, tally }));
    if (scored.length === 0) return null;
    const sorted = [...scored].sort((a, b) => b.rate - a.rate);
    return { best: sorted[0], worst: sorted[sorted.length - 1] };
  }, [rawRows, perRow]);

  const rows = useMemo(() => {
    if (sort === "rank") return rawRows;
    const withRate = rawRows.map((row) => {
      const tally = perRow.get(row.code) ?? EMPTY_TALLY;
      return { row, rate: rateOf(tally), graded: tally.hit + tally.miss };
    });
    // Ungraded rows sink to the bottom of both orderings rather than counting as
    // 0% or 100%, either of which would be a claim the data has not made.
    withRate.sort((a, b) => {
      if (a.rate === null && b.rate === null) return 0;
      if (a.rate === null) return 1;
      if (b.rate === null) return -1;
      return sort === "best" ? b.rate - a.rate : a.rate - b.rate;
    });
    return withRate.map((entry) => entry.row);
  }, [rawRows, perRow, sort]);

  /** The matrix only carries the compact per-cell fields (price/rate/hit) — the
   * detail popup needs the full call (probabilities, reliability, evidence, close
   * explanation) that only the per-stock history endpoint returns, so a click fetches
   * that on demand and opens the same PredictionDetailModal the AI 예측 page uses. */
  function openCell(code: string, date: string) {
    const key = `${code}:${date}`;
    setModalError(null);
    setPendingCell(key);
    api
      .predictionHistory(code, HISTORY_FETCH_LIMIT)
      .then((res) => {
        const item = res.items.find((i) => i.predict_date === date);
        if (item) {
          setSelected(item);
        } else {
          setModalError("해당 날짜의 예측 상세를 찾을 수 없습니다.");
        }
      })
      .catch((err: Error) => {
        setModalError(err.message || "예측 상세를 불러오지 못했습니다.");
      })
      .finally(() => {
        setPendingCell((cur) => (cur === key ? null : cur));
      });
  }

  return (
    <div className="app app--prediction-grading">
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
            <DashboardIcon /> 홈
          </Link>
          <Link to="/ai-prediction" className="kospi-map-nav-link">
            ← AI 예측으로
          </Link>
          <EtfNavLink />
        </div>
      </header>

      <section className="pred-matrix-hero">
        <h1 className="pred-matrix-title">채점 결과 매트릭스</h1>
        <p className="pred-matrix-sub">
          최근 {limit}거래일 동안 종목별 예측이 실제로 맞았는지 한 화면에서 확인합니다. 칸을 클릭하면 해당
          종목·날짜의 예측 상세를 볼 수 있습니다.
        </p>
      </section>

      {/* The scoreboard. The page is called 채점 결과 and never said what the
          result was — a reader had to count ✓ and ✕ out of a grid by eye to
          answer the one question it exists to answer. Everything here is counted
          from the same cells the grid draws, so the headline and the grid cannot
          disagree.

          채점 대기 is reported beside the rate rather than inside it: a call that
          has not traded yet is not a miss, and folding it in would drag every
          fresh session toward zero for reasons that have nothing to do with
          whether the model was right. */}
      {!error && !loading && rows.length > 0 ? (
        <section className="pred-score" aria-label="전체 채점 요약">
          <div className="pred-score-main">
            <span className="pred-score-label">전체 적중률</span>
            <RateBar tally={total} size="hero" />
          </div>
          <dl className="pred-score-stats">
            <div>
              <dt>적중</dt>
              <dd className="is-hit">{total.hit.toLocaleString()}</dd>
            </div>
            <div>
              <dt>실패</dt>
              <dd className="is-miss">{total.miss.toLocaleString()}</dd>
            </div>
            <div>
              <dt>채점 대기</dt>
              <dd className="is-pending">{total.pending.toLocaleString()}</dd>
            </div>
            <div>
              <dt>종목</dt>
              <dd>{rows.length.toLocaleString()}</dd>
            </div>
            <div>
              <dt>거래일</dt>
              <dd>{dates.length.toLocaleString()}</dd>
            </div>
          </dl>
          {extremes ? (
            <div className="pred-score-extremes">
              <span className="pred-score-extreme is-best">
                <b>최고</b> {extremes.best.row.name} {Math.round(extremes.best.rate)}%
              </span>
              <span className="pred-score-extreme is-worst">
                <b>최저</b> {extremes.worst.row.name} {Math.round(extremes.worst.rate)}%
              </span>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="pred-matrix-controls">
        <div className="pred-tabs" role="tablist" aria-label="시장 선택">
          {MARKET_TABS.map((tab) => (
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
        </div>
        <div className="pred-matrix-legend">
          <span className="pred-matrix-legend-item">
            <span className="pred-matrix-mark pred-matrix-mark--hit">✓</span> 적중
          </span>
          <span className="pred-matrix-legend-item">
            <span className="pred-matrix-mark pred-matrix-mark--miss">✕</span> 실패
          </span>
          <span className="pred-matrix-legend-item">
            <span className="pred-matrix-mark pred-matrix-mark--pending">···</span> 채점 대기
          </span>
          <label className="pred-sort">
            <span className="sr-only">정렬</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {SORTS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="pred-sort">
            <span className="sr-only">표시 기간</span>
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {LIMIT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  최근 {n}거래일
                </option>
              ))}
            </select>
          </label>
          {/* Compact drops the four numbers per cell and keeps the mark. At sixty
              columns the detailed cell is a wall of digits nobody reads across,
              and the grid was meant to be legible as a shape — which is exactly
              what four numbers per cell prevent. */}
          <button
            type="button"
            className={`pred-density${compact ? " is-on" : ""}`}
            aria-pressed={compact}
            onClick={() => setCompact((on) => !on)}
          >
            {compact ? "자세히" : "간략히"}
          </button>
        </div>
      </div>

      {error ? <p className="pred-error">{error}</p> : null}
      {modalError ? <p className="pred-error">{modalError}</p> : null}

      {!error && loading ? <p className="pred-matrix-loading">불러오는 중…</p> : null}

      {!error && !loading && rows.length === 0 ? (
        <p className="pred-empty">아직 채점된 예측이 없습니다.</p>
      ) : null}

      {!error && rows.length > 0 ? (
        <div className="pred-matrix-scroll">
          <table className={`pred-matrix${compact ? " pred-matrix--compact" : ""}`}>
            <thead>
              <tr>
                <th className="pred-matrix-stockhead" scope="col">
                  종목
                </th>
                {/* The per-stock answer, pinned beside the name so it travels
                    with the row rather than having to be counted along it. */}
                <th className="pred-matrix-ratehead" scope="col">
                  적중률
                </th>
                {dates.map((d) => (
                  <th key={d.date} scope="col" title={d.label}>
                    {shortDateLabel(d.date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.code}>
                  <th className="pred-matrix-stockhead" scope="row">
                    <span className="pred-matrix-stockname">{row.name}</span>
                    <span className="pred-matrix-stockmarket">{row.market}</span>
                  </th>
                  <td className="pred-matrix-ratecell">
                    <RateBar tally={perRow.get(row.code) ?? EMPTY_TALLY} />
                  </td>
                  {dates.map((d) => (
                    <MatrixCell
                      key={d.date}
                      cell={row.cells[d.date]}
                      market={row.market}
                      busy={pendingCell === `${row.code}:${d.date}`}
                      compact={compact}
                      onOpen={() => openCell(row.code, d.date)}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
            {/* The per-session answer. Reading down a column already showed how
                one day went; this states it, so a bad session is visible without
                counting a column of marks. Sticky to the bottom of the
                scrollport for the same reason the header row is sticky to the
                top — on sixty stocks it would otherwise be off-screen for the
                whole scroll. */}
            <tfoot>
              <tr>
                <th className="pred-matrix-stockhead" scope="row">
                  일자별 적중률
                </th>
                <td className="pred-matrix-ratecell">
                  <RateBar tally={total} />
                </td>
                {dates.map((d) => {
                  const tally = perDate.get(d.date) ?? EMPTY_TALLY;
                  const rate = rateOf(tally);
                  return (
                    <td
                      key={d.date}
                      className={`pred-matrix-datefoot is-${bandOf(rate)}`}
                      title={`${d.label} · 적중 ${tally.hit} / 채점 ${tally.hit + tally.miss}${
                        tally.pending ? ` · 대기 ${tally.pending}` : ""
                      }`}
                    >
                      <span className="pred-matrix-datefoot-value">
                        {rate === null ? "—" : `${Math.round(rate)}%`}
                      </span>
                      <span className="pred-matrix-datefoot-count">
                        {tally.hit + tally.miss === 0 ? "대기" : `${tally.hit}/${tally.hit + tally.miss}`}
                      </span>
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

      {selected ? <PredictionDetailModal item={selected} onClose={() => setSelected(null)} /> : null}

      <Footer />
    </div>
  );
}
