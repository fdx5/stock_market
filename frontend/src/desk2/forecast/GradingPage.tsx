import { useEffect, useMemo, useState } from "react";
import { GradingMatrixResponse, PredictionItem, api } from "../../api/client";
import { useLanguage } from "../../i18n/LanguageContext";
import { formatChangeRate, formatMoney } from "../../prediction";
import { Link } from "../../router";
import { useDocumentTitle } from "../../useDocumentTitle";
import Colophon from "../Colophon";
import Finder from "../Finder";
import Masthead from "../Masthead";
import { Marker, SectionHead, Skel } from "../parts";
import { useL } from "../lib";
import { useBroadsheet, useFinderHotkey } from "../shell";
import { ForecastReader, MARKET_EN, MARKET_KO, MARKET_ORDER, dirOf, shortDate } from "./shared";
import "../pages.css";
import "./forecast.css";
import "./grading.css";

/* 채점표 — every call, stock by session, on one sheet.
 *
 * Carried over whole: the market tabs, the 20/40/60-session window, the three
 * orderings, the detailed/compact cell, the per-stock and per-session rates, the
 * hit/miss/pending tally with pending kept out of the rate, the best and worst names
 * (five graded calls or more), and a cell opening the full call.
 *
 * New:
 *  - a headline that says the result, and each market's rate side by side;
 *  - 일자별 적중률 as a bar chart over the sessions — a bad day is a short bar,
 *    visible without reading a column of marks;
 *  - the three names most often right and most often wrong, not just one each;
 *  - search over the rows;
 *  - market, window, ordering, density and search live in the URL. */

type Cell = GradingMatrixResponse["rows"][number]["cells"][string];
type SortKey = "rank" | "best" | "worst";
interface Tally {
  hit: number;
  miss: number;
  pending: number;
}
const EMPTY: Tally = { hit: 0, miss: 0, pending: 0 };
const LIMITS = [20, 40, 60];

function add(t: Tally, c: Cell | undefined): Tally {
  if (!c) return t;
  if (c.hit === null) return { ...t, pending: t.pending + 1 };
  return c.hit ? { ...t, hit: t.hit + 1 } : { ...t, miss: t.miss + 1 };
}
function merge(a: Tally, b: Tally): Tally {
  return { hit: a.hit + b.hit, miss: a.miss + b.miss, pending: a.pending + b.pending };
}
function rateOf(t: Tally): number | null {
  const g = t.hit + t.miss;
  return g === 0 ? null : (t.hit / g) * 100;
}
function band(r: number | null): "none" | "bad" | "fair" | "good" {
  if (r === null) return "none";
  return r >= 60 ? "good" : r >= 45 ? "fair" : "bad";
}

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  const limit = Number(p.get("limit"));
  const sort = p.get("sort") as SortKey | null;
  return {
    market: p.get("market") ?? "ALL",
    limit: LIMITS.includes(limit) ? limit : 20,
    sort: (sort === "best" || sort === "worst" ? sort : "rank") as SortKey,
    compact: p.get("cells") === "compact",
    q: p.get("q") ?? "",
  };
}

function Rate({ t, big = false }: { t: Tally; big?: boolean }) {
  const L = useL();
  const r = rateOf(t);
  const g = t.hit + t.miss;
  return (
    <span className={`gr-rate is-${band(r)}${big ? " is-big" : ""}`}>
      <b>{r === null ? "—" : `${Math.round(r)}%`}</b>
      <span className="gr-rate-track" aria-hidden="true">
        <i style={{ width: `${r ?? 0}%` }} />
      </span>
      <small>{g === 0 ? L("채점 전", "none") : `${t.hit}/${g}`}</small>
    </span>
  );
}

export default function GradingPage() {
  const { lang } = useLanguage();
  const L = useL();
  useBroadsheet();
  useDocumentTitle("채점 결과 매트릭스 | K-Stock Hub");
  const init = useMemo(readUrl, []);
  const [market, setMarket] = useState(init.market);
  const [limit, setLimit] = useState(init.limit);
  const [sort, setSort] = useState<SortKey>(init.sort);
  const [compact, setCompact] = useState(init.compact);
  const [query, setQuery] = useState(init.q);
  const [data, setData] = useState<GradingMatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<PredictionItem | null>(null);
  const [cellError, setCellError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [finderOpen, setFinderOpen] = useState(false);
  useFinderHotkey(setFinderOpen);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .predictionGradingMatrix(market === "ALL" ? null : market, limit)
      .then((r) => !cancelled && setData(r))
      .catch((e: Error) => !cancelled && setError(e.message || L("채점 결과를 불러오지 못했습니다.", "Could not load the grades.")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, limit]);

  useEffect(() => {
    const p = new URLSearchParams();
    if (market !== "ALL") p.set("market", market);
    if (limit !== 20) p.set("limit", String(limit));
    if (sort !== "rank") p.set("sort", sort);
    if (compact) p.set("cells", "compact");
    if (query.trim()) p.set("q", query.trim());
    const next = `${window.location.pathname}${p.toString() ? `?${p}` : ""}`;
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, "", next);
  }, [market, limit, sort, compact, query]);

  const dates = useMemo(() => data?.dates ?? [], [data]);
  const raw = useMemo(() => data?.rows ?? [], [data]);

  const perRow = useMemo(() => {
    const m = new Map<string, Tally>();
    for (const row of raw) m.set(row.code, dates.reduce((t, d) => add(t, row.cells[d.date]), EMPTY));
    return m;
  }, [raw, dates]);
  const perDate = useMemo(() => {
    const m = new Map<string, Tally>();
    for (const d of dates) m.set(d.date, raw.reduce((t, row) => add(t, row.cells[d.date]), EMPTY));
    return m;
  }, [raw, dates]);
  const total = useMemo(() => [...perRow.values()].reduce(merge, EMPTY), [perRow]);
  const perMarket = useMemo(() => {
    const m = new Map<string, Tally>();
    for (const row of raw) m.set(row.market, merge(m.get(row.market) ?? EMPTY, perRow.get(row.code) ?? EMPTY));
    return MARKET_ORDER.filter((k) => m.has(k)).map((k) => ({ market: k, t: m.get(k)! }));
  }, [raw, perRow]);

  const extremes = useMemo(() => {
    const scored = raw
      .map((row) => ({ row, t: perRow.get(row.code) ?? EMPTY }))
      .filter(({ t }) => t.hit + t.miss >= 5)
      .map((x) => ({ ...x, r: rateOf(x.t) ?? 0 }))
      .sort((a, b) => b.r - a.r);
    return scored.length ? { best: scored.slice(0, 3), worst: scored.slice(-3).reverse() } : null;
  }, [raw, perRow]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle ? raw.filter((r) => r.name.toLowerCase().includes(needle) || r.code.toLowerCase().includes(needle)) : raw;
    if (sort === "rank") return list;
    return [...list].sort((a, b) => {
      const ra = rateOf(perRow.get(a.code) ?? EMPTY);
      const rb = rateOf(perRow.get(b.code) ?? EMPTY);
      if (ra === null && rb === null) return 0;
      if (ra === null) return 1;
      if (rb === null) return -1;
      return sort === "best" ? rb - ra : ra - rb;
    });
  }, [raw, perRow, sort, query]);

  // The matrix carries only the compact cell; the full call comes from the stock's
  // history, fetched on click, and opens the same reader the forecast page uses.
  const openCell = (code: string, date: string) => {
    const key = `${code}:${date}`;
    setCellError("");
    setBusy(key);
    api
      .predictionHistory(code, 90)
      .then((r) => {
        const item = r.items.find((i) => i.predict_date === date);
        if (item) setSelected(item);
        else setCellError(L("해당 날짜의 예측 상세를 찾을 수 없습니다.", "That call's detail was not found."));
      })
      .catch((e: Error) => setCellError(e.message || L("예측 상세를 불러오지 못했습니다.", "Could not load the call.")))
      .finally(() => setBusy((cur) => (cur === key ? null : cur)));
  };

  const totalRate = rateOf(total);
  const headline =
    totalRate === null
      ? L("아직 채점된 예측이 없습니다", "Nothing graded yet")
      : L(
          `최근 ${dates.length}거래일 적중률 ${Math.round(totalRate)}%, ${(total.hit + total.miss).toLocaleString()}건 중 ${total.hit.toLocaleString()}건`,
          `${Math.round(totalRate)}% right over ${dates.length} sessions — ${total.hit.toLocaleString()} of ${(total.hit + total.miss).toLocaleString()}`
        );
  const chartDates = [...dates].reverse();

  return (
    <div className="d2 fc gr" lang={lang}>
      <a className="d2-skip" href="#gr-sheet">
        {L("본문 바로가기", "Skip to content")}
      </a>
      <Masthead
        rail={false}
        onPrint={() => window.print()}
        section={{ ko: "채점 결과", en: "The Scorecard", taglineKo: "AI 예측 한 건 한 건을, 종목 × 날짜로 채점한 성적표", taglineEn: "Every AI call, graded — stock by session" }}
      />

      <div className="d2-cmd gr-bar" data-d2-sticky>
        <div className="d2-cmd-inner gr-bar-inner">
          <Link to="/ai-prediction" className="gr-back">
            ← {L("AI 예측", "Forecast")}
          </Link>
          <Marker
            options={[{ id: "ALL", label: L("전체", "All") }, ...MARKET_ORDER.map((m) => ({ id: m, label: lang === "ko" ? MARKET_KO[m] : MARKET_EN[m] }))]}
            value={market}
            onChange={setMarket}
            label={L("시장", "Market")}
          />
          <div className="sk-seg" role="group" aria-label={L("기간", "Window")}>
            {LIMITS.map((n) => (
              <button key={n} type="button" className={limit === n ? "is-on" : ""} aria-pressed={limit === n} onClick={() => setLimit(n)}>
                {n}
                {L("일", "d")}
              </button>
            ))}
          </div>
          <label className="st-search gr-search">
            <span aria-hidden="true">⌕</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L("종목명 · 코드", "Name or code")} aria-label={L("종목 검색", "Search")} autoComplete="off" />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label={L("지우기", "Clear")}>
                ×
              </button>
            )}
          </label>
        </div>
      </div>

      <main className="d2-main">
        <section className="d2-sec fc-front" aria-label={L("채점 요약", "Summary")}>
          <p className="d2-lead-kicker">
            <span className="d2-lead-status">{L("채점표", "Scorecard")}</span>
            <span>{market === "ALL" ? L("코스피 · 코스닥 · 나스닥", "KOSPI · KOSDAQ · NASDAQ") : lang === "ko" ? MARKET_KO[market] : MARKET_EN[market]}</span>
            {dates.length > 0 && (
              <span>
                {shortDate(dates[dates.length - 1].date)} – {shortDate(dates[0].date)}
              </span>
            )}
          </p>
          {loading && !data ? (
            <div className="sk-loading">
              <Skel h={44} w="60%" />
              <Skel h={140} />
            </div>
          ) : error ? (
            <p className="d2-empty">{error}</p>
          ) : (
            <>
              <h2 className="fc-head">{headline}</h2>
              <div className="fc-front-grid gr-front-grid">
                <div>
                  <div className="gr-tally">
                    <Rate t={total} big />
                    <dl>
                      <div>
                        <dt>{L("적중", "Hits")}</dt>
                        <dd className="is-good">{total.hit.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>{L("빗나감", "Misses")}</dt>
                        <dd className="is-bad">{total.miss.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>{L("채점 대기", "Pending")}</dt>
                        <dd>{total.pending.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>{L("종목 · 거래일", "Names · sessions")}</dt>
                        <dd>
                          {raw.length} · {dates.length}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  {perMarket.length > 1 && (
                    <div className="gr-markets">
                      {perMarket.map((m) => (
                        <button key={m.market} type="button" onClick={() => setMarket(m.market)}>
                          <span>{lang === "ko" ? MARKET_KO[m.market] : MARKET_EN[m.market]}</span>
                          <Rate t={m.t} />
                        </button>
                      ))}
                    </div>
                  )}
                  <h3 className="sk-col-head gr-chart-head">{L("일자별 적중률", "By session")}</h3>
                  <div className="gr-chart" role="img" aria-label={L("거래일별 적중률 막대그래프", "Hit rate per session")}>
                    <span className="gr-chart-50" aria-hidden="true">
                      <i>50%</i>
                    </span>
                    {chartDates.map((d) => {
                      const t = perDate.get(d.date) ?? EMPTY;
                      const r = rateOf(t);
                      return (
                        <span key={d.date} className={`is-${band(r)}`} title={`${d.label} · ${r === null ? L("채점 대기", "pending") : `${Math.round(r)}% (${t.hit}/${t.hit + t.miss})`}`}>
                          <i style={{ height: `${Math.max(2, r ?? 0)}%` }} />
                          <small>{shortDate(d.date)}</small>
                        </span>
                      );
                    })}
                  </div>
                  <p className="fc-note">{L("채점 대기(아직 거래되지 않은 예측)는 적중률에 넣지 않습니다. 맞히지 못한 것이 아니라 아직 모르는 것이기 때문입니다.", "Pending calls — sessions not yet traded — are left out of every rate: they are unknown, not wrong.")}</p>
                </div>
                <aside className="fc-front-side">
                  {extremes ? (
                    <>
                      <div className="gr-podium">
                        <h3 className="sk-col-head">{L("가장 잘 맞힌 종목", "Most often right")}</h3>
                        <ol>
                          {extremes.best.map((x) => (
                            <li key={x.row.code}>
                              <span>{x.row.name}</span>
                              <b className="is-good">{Math.round(x.r)}%</b>
                              <small>
                                {x.t.hit}/{x.t.hit + x.t.miss}
                              </small>
                            </li>
                          ))}
                        </ol>
                      </div>
                      <div className="gr-podium">
                        <h3 className="sk-col-head">{L("가장 많이 빗나간 종목", "Most often wrong")}</h3>
                        <ol>
                          {extremes.worst.map((x) => (
                            <li key={x.row.code}>
                              <span>{x.row.name}</span>
                              <b className="is-bad">{Math.round(x.r)}%</b>
                              <small>
                                {x.t.hit}/{x.t.hit + x.t.miss}
                              </small>
                            </li>
                          ))}
                        </ol>
                      </div>
                      <p className="fc-note">{L("채점된 예측이 5건 이상인 종목만 셉니다.", "Only names with five or more graded calls.")}</p>
                    </>
                  ) : (
                    <p className="d2-empty">{L("순위를 매길 만큼 채점된 종목이 아직 없습니다.", "Not enough graded calls to rank names yet.")}</p>
                  )}
                </aside>
              </div>
            </>
          )}
        </section>

        <section id="gr-sheet" className="d2-sec" aria-labelledby="gr-sheet-h">
          <SectionHead
            id="gr-sheet-h"
            no="01"
            kicker={L("매트릭스", "The matrix")}
            title={L("종목 × 날짜 채점표", "Stock by session")}
            note={L(`${rows.length}종목 · 최신 거래일이 왼쪽입니다. 칸을 누르면 그날의 예측 상세가 열립니다.`, `${rows.length} names · newest session on the left. Open a cell for that call.`)}
          />
          <div className="fc-controls">
            <Marker
              options={[
                { id: "rank" as SortKey, label: L("기본 순서", "Default") },
                { id: "best" as SortKey, label: L("적중률 높은 순", "Best first") },
                { id: "worst" as SortKey, label: L("적중률 낮은 순", "Worst first") },
              ]}
              value={sort}
              onChange={setSort}
              label={L("정렬", "Order")}
            />
            <div className="fc-controls-right">
              <span className="gr-legend">
                <span className="gr-mark is-hit">✓</span> {L("적중", "Hit")}
                <span className="gr-mark is-miss">✕</span> {L("빗나감", "Miss")}
                <span className="gr-mark is-pending">·</span> {L("채점 대기", "Pending")}
              </span>
              <div className="sk-seg" role="group" aria-label={L("칸 표시", "Cells")}>
                <button type="button" className={!compact ? "is-on" : ""} aria-pressed={!compact} onClick={() => setCompact(false)}>
                  {L("자세히", "Detailed")}
                </button>
                <button type="button" className={compact ? "is-on" : ""} aria-pressed={compact} onClick={() => setCompact(true)}>
                  {L("간략히", "Compact")}
                </button>
              </div>
            </div>
          </div>
          {cellError && <p className="sk-error">{cellError}</p>}
          {loading && !data && <Skel h={420} />}
          {!loading && !error && rows.length === 0 && <p className="d2-empty">{query ? L("검색과 맞는 종목이 없습니다.", "No names match.") : L("아직 채점된 예측이 없습니다.", "Nothing graded yet.")}</p>}
          {rows.length > 0 && (
            <div className={`gr-scroll${loading ? " is-refreshing" : ""}`}>
              <table className={`gr-matrix${compact ? " is-compact" : ""}`}>
                <thead>
                  <tr>
                    <th className="gr-stock" scope="col">
                      {L("종목", "Name")}
                    </th>
                    <th className="gr-ratecol" scope="col">
                      {L("적중률", "Rate")}
                    </th>
                    {dates.map((d) => (
                      <th key={d.date} scope="col" title={d.label}>
                        {shortDate(d.date)}
                        <small>{d.weekday}</small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.code}>
                      <th className="gr-stock" scope="row">
                        <b>{row.name}</b>
                        <small>{MARKET_KO[row.market] ?? row.market}</small>
                      </th>
                      <td className="gr-ratecol">
                        <Rate t={perRow.get(row.code) ?? EMPTY} />
                      </td>
                      {dates.map((d) => {
                        const c = row.cells[d.date];
                        if (!c) return <td key={d.date} className="gr-cell is-empty" aria-label={L("예측 없음", "No call")} />;
                        const state = c.hit === null ? "pending" : c.hit ? "hit" : "miss";
                        const isBusy = busy === `${row.code}:${d.date}`;
                        const title = `${row.name} ${shortDate(d.date)} · ${L("예측", "call")} ${c.result} ${formatChangeRate(c.change_rate)}${
                          c.actual_price === null ? "" : ` · ${L("실제", "actual")} ${c.actual_result ?? ""} ${formatChangeRate(c.actual_change_rate ?? 0)}`
                        }`;
                        return (
                          <td key={d.date} className={`gr-cell is-${state}`}>
                            <button type="button" disabled={isBusy} aria-busy={isBusy} onClick={() => openCell(row.code, d.date)} title={title}>
                              <span className="gr-mark" aria-hidden="true">
                                {isBusy ? "…" : state === "hit" ? "✓" : state === "miss" ? "✕" : "·"}
                              </span>
                              {!compact && (
                                <>
                                  <span className={`gr-line is-${dirOf(c.result)}`}>
                                    {c.result} {formatChangeRate(c.change_rate)}
                                  </span>
                                  <span className="gr-line gr-line--px">{formatMoney(c.predict_price, row.market)}</span>
                                  <span className={`gr-line gr-line--act${c.actual_result ? ` is-${dirOf(c.actual_result)}` : ""}`}>
                                    {c.hit === null || c.actual_price === null ? L("채점 대기", "pending") : `${L("실제", "act.")} ${formatChangeRate(c.actual_change_rate ?? 0)}`}
                                  </span>
                                </>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th className="gr-stock" scope="row">
                      {L("일자별", "By session")}
                    </th>
                    <td className="gr-ratecol">
                      <Rate t={total} />
                    </td>
                    {dates.map((d) => {
                      const t = perDate.get(d.date) ?? EMPTY;
                      const r = rateOf(t);
                      return (
                        <td key={d.date} className={`gr-foot is-${band(r)}`}>
                          <b>{r === null ? "—" : `${Math.round(r)}%`}</b>
                          <small>{t.hit + t.miss === 0 ? L("대기", "pend.") : `${t.hit}/${t.hit + t.miss}`}</small>
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="sk-disclaimer">
            {L(
              "채점은 예측일의 실제 종가를 예측 당시의 보합 폭(종목별 20일 변동성 기준)으로 판정합니다. 과거 적중률은 미래 성과를 보장하지 않습니다.",
              "Each call is graded on the session's actual close, against the flat band it was made with. Past hit rates say nothing certain about future ones."
            )}
          </p>
        </section>
      </main>

      <Colophon />
      <Finder open={finderOpen} onClose={() => setFinderOpen(false)} />
      {selected && <ForecastReader item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
