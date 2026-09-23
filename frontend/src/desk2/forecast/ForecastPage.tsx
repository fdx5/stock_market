import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PredictionAccuracy, PredictionDateOption, PredictionDay, PredictionItem, SessionScore, api } from "../../api/client";
import { useLanguage } from "../../i18n/LanguageContext";
import StockLogo from "../../components/StockLogo";
import {
  formatChangeRate,
  formatCountdown,
  formatFullDate,
  formatGeneratedAt,
  formatMoney,
  formatPrice,
  marketOpenInstant,
  probabilities,
} from "../../prediction";
import { Link } from "../../router";
import { useDocumentTitle } from "../../useDocumentTitle";
import Colophon from "../Colophon";
import Finder from "../Finder";
import Masthead from "../Masthead";
import { Marker, SectionHead, Skel } from "../parts";
import { useL } from "../lib";
import { useBroadsheet, useFinderHotkey } from "../shell";
import { Dir, ForecastReader, MARKET_EN, MARKET_KO, MARKET_ORDER, ProbBar, Stamp, Verdict, dirOf, grade, shortDate } from "./shared";
import "../pages.css";
import "./forecast.css";

/* AI 예측면 — the next session, written down before it happens.
 *
 * Everything the classic page carried is here on the same four endpoints: the date
 * navigator (and ← / → over it), the per-market scoreboard, the open countdown, the
 * direction split and average reliability, the three strongest calls, market tabs
 * (including the "that market's batch is on another day" jump), search, card and
 * list views, the 신뢰도 낮음 filter, seven orderings, the twelve-a-market fold, the
 * shared index/FX context per market, and the full reader with its track record.
 *
 * What is new:
 *  - the page leads like a forecast page: a headline written from the numbers, the
 *    split drawn as one bar, the countdown in the deck;
 *  - the scoreboard is a table — each market's last graded session, its 20-session
 *    rate and a bar per session — so the record is read before the calls are;
 *  - on a graded day, 예측 × 실제: a three-by-three table of what was called against
 *    what happened, which says more about the model than one hit rate;
 *  - 적중 / 빗나감 filter on a graded day;
 *  - in the reader, ← / → walk to the neighbouring call in the current order;
 *  - date, market, ordering, view, filters and search live in the URL. */

type SortKey = "marketcap" | "conviction" | "probability" | "reliability" | "change" | "accuracy" | "name";
type View = "card" | "table";
type Outcome = "all" | "hit" | "miss";

const SORTS: { id: SortKey; ko: string; en: string }[] = [
  { id: "marketcap", ko: "시가총액", en: "Size" },
  { id: "conviction", ko: "확신도", en: "Conviction" },
  { id: "probability", ko: "상승확률", en: "Up odds" },
  { id: "reliability", ko: "신뢰도", en: "Reliability" },
  { id: "change", ko: "예상 등락", en: "Expected" },
  { id: "accuracy", ko: "20일 적중률", en: "20D record" },
  { id: "name", ko: "이름", en: "Name" },
];

/* Twelve a market before it asks — four rows of the widest grid, two of the narrowest. */
const GROUP_PAGE = 12;

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  const sort = p.get("sort") as SortKey | null;
  const outcome = p.get("outcome") as Outcome | null;
  return {
    date: p.get("date"),
    market: p.get("market") ?? "ALL",
    sort: (sort && SORTS.some((s) => s.id === sort) ? sort : "marketcap") as SortKey,
    view: (p.get("view") === "table" || p.get("view") === "list" ? "table" : "card") as View,
    q: p.get("q") ?? "",
    hide: p.get("hide") === "1",
    outcome: (outcome === "hit" || outcome === "miss" ? outcome : "all") as Outcome,
  };
}

function storedView(): View | null {
  try {
    const v = window.localStorage.getItem("pred:view");
    return v === "list" ? "table" : v === "card" ? "card" : null;
  } catch {
    return null;
  }
}

function sortItems(items: PredictionItem[], key: SortKey): PredictionItem[] {
  const copy = [...items];
  if (key === "marketcap") copy.sort((a, b) => (b.market_cap ?? -1) - (a.market_cap ?? -1));
  else if (key === "conviction") copy.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  else if (key === "probability") copy.sort((a, b) => (probabilities(b)?.up ?? -1) - (probabilities(a)?.up ?? -1));
  else if (key === "reliability") copy.sort((a, b) => (b.reliability ?? -1) - (a.reliability ?? -1));
  else if (key === "change") copy.sort((a, b) => b.change_rate - a.change_rate);
  else if (key === "accuracy") copy.sort((a, b) => (b.accuracy?.recent20.rate ?? -1) - (a.accuracy?.recent20.rate ?? -1));
  else copy.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return copy;
}

function rollup(sessions: SessionScore[], n: number) {
  const slice = sessions.slice(0, n);
  const total = slice.reduce((s, x) => s + x.total, 0);
  const hit = slice.reduce((s, x) => s + x.hit, 0);
  return { total, hit, rate: total ? Math.round((hit / total) * 100) : null };
}

/** Counts down to the opening bell of the session being called, and says so once
 * it has rung instead of counting into negative numbers. */
function Countdown({ iso, market }: { iso: string; market: string }) {
  const L = useL();
  const target = useMemo(() => marketOpenInstant(iso, market), [iso, market]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [target]);
  if (!target) return null;
  const left = formatCountdown(target.getTime() - now);
  const where = market === "NASDAQ" ? L("뉴욕 증시", "New York") : L("한국 증시", "Seoul");
  return (
    <p className="fc-count">
      {left ? (
        <>
          <span>
            {where} {L("개장까지", "opens in")}
          </span>
          <b>{left}</b>
        </>
      ) : (
        <>
          <span>{where}</span>
          <b>{L("장이 열렸습니다", "is open")}</b>
        </>
      )}
    </p>
  );
}

function Scoreboard({ accuracy }: { accuracy: PredictionAccuracy }) {
  const L = useL();
  const { lang } = useLanguage();
  const markets = MARKET_ORDER.filter((m) => accuracy.sessions_by_market[m]?.length);
  if (markets.length === 0) return null;
  return (
    <table className="fc-board">
      <caption>{L("시장별 적중 성적", "The record, by market")}</caption>
      <thead>
        <tr>
          <th>{L("시장", "Market")}</th>
          <th>{L("직전 채점", "Last graded")}</th>
          <th>{L("20거래일", "20 sessions")}</th>
          <th className="fc-board-bars">{L("회차별", "By session")}</th>
        </tr>
      </thead>
      <tbody>
        {markets.map((m) => {
          const sessions = accuracy.sessions_by_market[m];
          const last = sessions[0];
          const r20 = rollup(sessions, 20);
          return (
            <tr key={m}>
              <th scope="row">{lang === "ko" ? MARKET_KO[m] : MARKET_EN[m]}</th>
              <td>
                <b className={`is-${grade(last)}`}>{last.rate ?? "—"}%</b>
                <small>
                  {shortDate(last.predict_date)} · {last.hit}/{last.total}
                </small>
              </td>
              <td>
                <b className={`is-${grade(r20)}`}>{r20.rate ?? "—"}%</b>
                <small>
                  {r20.hit}/{r20.total}
                </small>
              </td>
              <td className="fc-board-bars">
                <span className="fc-bars" role="img" aria-label={L("최근 채점 회차별 적중률", "Hit rate by recent session")}>
                  {[...sessions]
                    .slice(0, 16)
                    .reverse()
                    .map((s) => (
                      <i
                        key={s.predict_date}
                        className={`is-${s.rate === null ? "none" : s.rate >= 60 ? "good" : s.rate >= 40 ? "mid" : "bad"}`}
                        style={{ height: `${Math.max(6, s.rate ?? 0)}%` }}
                        title={`${shortDate(s.predict_date)} · ${s.rate ?? "—"}% (${s.hit}/${s.total})`}
                      />
                    ))}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** 예측 × 실제 — what was called against what happened, on a graded day. */
function Confusion({ items }: { items: PredictionItem[] }) {
  const L = useL();
  const graded = items.filter((i) => i.hit !== null && i.actual_result);
  if (graded.length === 0) return null;
  const dirs: PredictionItem["result"][] = ["상승", "보합", "하락"];
  const cell = (p: string, a: string) => graded.filter((i) => i.result === p && i.actual_result === a).length;
  const max = Math.max(1, ...dirs.flatMap((p) => dirs.map((a) => cell(p, a))));
  const hits = graded.filter((i) => i.hit).length;
  return (
    <div className="fc-confusion">
      <h3 className="sk-col-head">{L("예측 × 실제", "Called × happened")}</h3>
      <table>
        <thead>
          <tr>
            <th />
            {dirs.map((a) => (
              <th key={a} scope="col">
                {L("실제", "Actual")} {a}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dirs.map((p) => (
            <tr key={p}>
              <th scope="row" className={`is-${dirOf(p)}`}>
                {L("예측", "Called")} {p}
              </th>
              {dirs.map((a) => {
                const n = cell(p, a);
                return (
                  <td key={a} className={p === a ? "is-diag" : ""} style={{ ["--w" as string]: (n / max).toFixed(2) }}>
                    <b>{n}</b>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fc-note">
        {L(
          `대각선이 맞힌 칸입니다. ${graded.length}건 중 ${hits}건 적중. 보합 폭은 종목마다 달라 같은 등락률도 종목에 따라 보합이거나 아닐 수 있습니다.`,
          `The diagonal is where the call was right: ${hits} of ${graded.length}. The flat band differs by stock, so the same move can be flat for one name and not another.`
        )}
      </p>
    </div>
  );
}

function Card({ item, rank, onOpen }: { item: PredictionItem; rank?: number; onOpen: () => void }) {
  const L = useL();
  const d = dirOf(item.result);
  const r20 = item.accuracy?.recent20;
  return (
    <button
      type="button"
      className={`fc-card is-${d}${item.hit === null ? "" : item.hit ? " is-hit" : " is-miss"}${item.reliability_grade === "낮음" ? " is-weak" : ""}`}
      onClick={onOpen}
      aria-label={L(`${item.name} ${item.result} 예측 ${formatChangeRate(item.change_rate)}, 상세 보기`, `${item.name}, ${formatChangeRate(item.change_rate)} — open`)}
    >
      <span className="fc-card-top">
        <StockLogo code={item.code} name={item.name} className="fc-logo" />
        <span className="fc-card-id">
          <b>{item.name}</b>
          <small>
            {rank ? L(`시총 ${rank}위 · `, `#${rank} · `) : ""}
            {item.code}
          </small>
        </span>
        <Verdict result={item.result} />
      </span>
      <span className="fc-card-fig">
        <b className="d2-num">{formatPrice(item.predict_price, item.market)}</b>
        <em className={`d2-num is-${d}`}>{formatChangeRate(item.change_rate)}</em>
      </span>
      <span className="fc-card-base">
        {L("기준", "from")} {formatMoney(item.base_price, item.market)}
      </span>
      <ProbBar item={item} />
      <span className="fc-card-tags">
        {item.reliability_grade && (
          <span className={`fc-rel is-${item.reliability_grade === "높음" ? "high" : item.reliability_grade === "낮음" ? "low" : "mid"}`}>
            {L("신뢰도", "Rel.")} {item.reliability_grade}
            {item.reliability !== null ? ` ${item.reliability}` : ""}
          </span>
        )}
        {item.confidence !== "약" && <span className={item.confidence === "강" ? "is-strong" : ""}>{L(`확신도 ${item.confidence}`, `Conviction ${item.confidence}`)}</span>}
        {r20 && r20.rate !== null && <span className={`is-${grade(r20)}`}>{L(`20일 적중 ${r20.rate}%`, `20D ${r20.rate}%`)}</span>}
      </span>
      {item.close_summary && <span className="fc-card-close">{item.close_summary}</span>}
      {item.hit !== null && (
        <span className="fc-card-outcome">
          <Stamp hit={item.hit} />
          {item.actual_result ? (
            <span>
              {L("실제", "Actual")} <b className={`is-${dirOf(item.actual_result)}`}>{item.actual_result}</b>
              {item.actual_change_rate !== null && <em className="d2-num"> {formatChangeRate(item.actual_change_rate)}</em>}
            </span>
          ) : (
            <span className="d2-muted">{L("실제 시세 확인 불가", "No actual price")}</span>
          )}
        </span>
      )}
      <span className="fc-card-cta">
        {L(`근거 ${item.evidence.length}건`, `${item.evidence.length} inputs`)} →
      </span>
    </button>
  );
}

function Rows({ items, rankOf, onOpen }: { items: PredictionItem[]; rankOf: Map<string, number>; onOpen: (item: PredictionItem) => void }) {
  const L = useL();
  return (
    <div className="d2-table-wrap fc-table">
      <table className="d2-table">
        <thead>
          <tr>
            <th className="is-rank">#</th>
            <th className="is-name">{L("종목", "Name")}</th>
            <th>{L("예측", "Call")}</th>
            <th>{L("예측 시세", "Forecast")}</th>
            <th>{L("예상 등락", "Expected")}</th>
            <th>{L("상승·보합·하락", "Up·flat·down")}</th>
            <th>{L("신뢰도", "Rel.")}</th>
            <th>{L("20일 적중", "20D")}</th>
            <th>{L("결과", "Result")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const p = probabilities(it);
            const d = dirOf(it.result);
            return (
              <tr key={it.code} onClick={() => onOpen(it)} className="is-click">
                <td className="is-rank">{rankOf.get(it.code) ?? "—"}</td>
                <td className="is-name">
                  <button type="button" onClick={() => onOpen(it)}>
                    <StockLogo code={it.code} name={it.name} className="fc-logo fc-logo--sm" />
                    {it.name}
                  </button>
                </td>
                <td className={`is-${d}`}>{it.result}</td>
                <td>{formatPrice(it.predict_price, it.market)}</td>
                <td className={`is-${d}`}>{formatChangeRate(it.change_rate)}</td>
                <td>
                  {p ? (
                    <span className="fc-tprob">
                      <span className="fc-prob-bar" aria-hidden="true">
                        <i className="is-up" style={{ width: `${p.up}%` }} />
                        <i className="is-flat" style={{ width: `${p.flat}%` }} />
                        <i className="is-down" style={{ width: `${p.down}%` }} />
                      </span>
                      {p.up}·{p.flat}·{p.down}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{it.reliability ?? "—"}</td>
                <td>{it.accuracy?.recent20.rate != null ? `${it.accuracy.recent20.rate}%` : "—"}</td>
                <td>{it.hit === null ? <span className="d2-muted">{L("채점 전", "Pending")}</span> : <Stamp hit={it.hit} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ForecastPage() {
  const { lang } = useLanguage();
  const L = useL();
  useBroadsheet();
  useDocumentTitle("AI 종목예측 | K-Stock Hub");
  const init = useMemo(readUrl, []);
  const [dates, setDates] = useState<PredictionDateOption[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(init.date);
  const [day, setDay] = useState<PredictionDay | null>(null);
  const [accuracy, setAccuracy] = useState<PredictionAccuracy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [market, setMarket] = useState(init.market);
  const [sort, setSort] = useState<SortKey>(init.sort);
  const [view, setView] = useState<View>(() => (window.location.search.includes("view=") ? init.view : storedView() ?? "card"));
  const [query, setQuery] = useState(init.q);
  const [hideWeak, setHideWeak] = useState(init.hide);
  const [outcome, setOutcome] = useState<Outcome>(init.outcome);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [finderOpen, setFinderOpen] = useState(false);
  useFinderHotkey(setFinderOpen);
  const loadedOnce = useRef(false);

  useEffect(() => {
    api.predictionAccuracy().then(setAccuracy).catch(() => {});
    api
      .predictionDates()
      .then((r) => setDates(r.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .predictions(selectedDate)
      .then((r) => {
        if (cancelled) return;
        setDay(r);
        loadedOnce.current = true;
        if (!selectedDate && r.date) setSelectedDate(r.date);
      })
      .catch((e: Error) => !cancelled && setError(e.message || L("예측 데이터를 불러오지 못했습니다.", "Could not load the forecast.")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // The URL carries the reader's place; the view is also remembered across visits.
  useEffect(() => {
    const p = new URLSearchParams();
    if (selectedDate && dates[0] && selectedDate !== dates[0].date) p.set("date", selectedDate);
    if (market !== "ALL") p.set("market", market);
    if (sort !== "marketcap") p.set("sort", sort);
    if (view !== "card") p.set("view", view);
    if (query.trim()) p.set("q", query.trim());
    if (hideWeak) p.set("hide", "1");
    if (outcome !== "all") p.set("outcome", outcome);
    const next = `${window.location.pathname}${p.toString() ? `?${p}` : ""}`;
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, "", next);
    try {
      window.localStorage.setItem("pred:view", view === "table" ? "list" : "card");
    } catch {
      /* a preference, not a dependency */
    }
  }, [selectedDate, dates, market, sort, view, query, hideWeak, outcome]);

  const rankOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of day?.groups ?? []) [...g.items].sort((a, b) => (b.market_cap ?? -1) - (a.market_cap ?? -1)).forEach((it, i) => m.set(it.code, i + 1));
    return m;
  }, [day]);

  const groups = useMemo(() => {
    if (!day) return [];
    const needle = query.trim().toLowerCase();
    return (market === "ALL" ? day.groups : day.groups.filter((g) => g.market === market))
      .map((g) => {
        let items = g.items;
        if (hideWeak) items = items.filter((i) => i.reliability_grade !== "낮음");
        if (outcome !== "all") items = items.filter((i) => i.hit === (outcome === "hit"));
        if (needle) items = items.filter((i) => i.name.toLowerCase().includes(needle) || i.code.toLowerCase().includes(needle));
        return { ...g, items: sortItems(items, sort) };
      })
      .filter((g) => g.items.length > 0);
  }, [day, market, hideWeak, outcome, query, sort]);

  // The whole day in the chosen market, before the reader's narrowing — the front
  // block reports the forecast, not the filter.
  const scope = useMemo(() => (day ? (market === "ALL" ? day.groups : day.groups.filter((g) => g.market === market)).flatMap((g) => g.items) : []), [day, market]);

  const totals = useMemo(() => {
    const up = scope.filter((i) => i.result === "상승").length;
    const down = scope.filter((i) => i.result === "하락").length;
    const rels = scope.map((i) => i.reliability).filter((r): r is number => r !== null);
    const ups = scope.map((i) => probabilities(i)?.up).filter((p): p is number => p !== undefined);
    const graded = scope.filter((i) => i.hit !== null);
    return {
      total: scope.length,
      up,
      down,
      flat: scope.length - up - down,
      avg: scope.length ? scope.reduce((s, i) => s + i.change_rate, 0) / scope.length : 0,
      rel: rels.length ? Math.round(rels.reduce((a, b) => a + b, 0) / rels.length) : null,
      upProb: ups.length ? Math.round(ups.reduce((a, b) => a + b, 0) / ups.length) : null,
      graded: graded.length,
      hit: graded.filter((i) => i.hit).length,
      weak: scope.filter((i) => i.reliability_grade === "낮음").length,
    };
  }, [scope]);

  const top3 = useMemo(() => [...groups.flatMap((g) => g.items)].sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 3), [groups]);

  const elsewhere = useMemo(() => {
    if (!day) return [];
    const present = new Set(day.groups.map((g) => g.market));
    const seen = new Set<string>();
    const out: { market: string; date: PredictionDateOption }[] = [];
    for (const d of dates)
      for (const m of d.markets ?? []) {
        if (present.has(m) || seen.has(m)) continue;
        seen.add(m);
        out.push({ market: m, date: d });
      }
    return out;
  }, [day, dates]);

  const idx = dates.findIndex((d) => d.date === (day?.date ?? selectedDate));
  const older = idx >= 0 ? dates[idx + 1] : undefined;
  const newer = idx > 0 ? dates[idx - 1] : undefined;
  const flat = useMemo(() => groups.flatMap((g) => (expanded[g.market] || g.items.length <= GROUP_PAGE ? g.items : g.items.slice(0, GROUP_PAGE))), [groups, expanded]);
  const openItem = openCode ? flat.find((i) => i.code === openCode) ?? scope.find((i) => i.code === openCode) ?? null : null;

  const step = useCallback(
    (delta: -1 | 1) => {
      if (!openCode || flat.length === 0) return;
      const at = flat.findIndex((i) => i.code === openCode);
      const next = flat[(at + delta + flat.length) % flat.length];
      if (next) setOpenCode(next.code);
    },
    [openCode, flat]
  );

  // ← / → move through 예측일자 while no reader is open and nothing is being typed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (openCode || finderOpen) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const next = e.key === "ArrowLeft" ? older : newer;
      if (!next) return;
      e.preventDefault();
      setSelectedDate(next.date);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [older, newer, openCode, finderOpen]);

  const settled = totals.total > 0 && totals.graded === totals.total;
  const countdownMarket = (market !== "ALL" ? market : day?.groups[0]?.market) ?? null;
  const showSkel = loading && !loadedOnce.current;
  const lean = totals.up > totals.down ? L("상승 우세", "leaning up") : totals.down > totals.up ? L("하락 우세", "leaning down") : L("팽팽", "evenly split");
  const scopeName = market === "ALL" ? L("3개 시장", "three markets") : lang === "ko" ? MARKET_KO[market] : MARKET_EN[market];
  const dayShort = day?.date ? `${Number(day.date.slice(4, 6))}월 ${Number(day.date.slice(6, 8))}일` : "";
  const headline = !day?.date
    ? L("예측 데이터 준비 중", "The forecast is being prepared")
    : settled
      ? L(`${dayShort} 예보 채점, ${totals.total}종목 중 ${totals.hit}종목 적중`, `${day.label}: ${totals.hit} of ${totals.total} calls right`)
      : L(`${dayShort} 예보, ${scopeName} ${totals.total}종목 ${lean}`, `${day.label}: ${totals.total} calls across ${scopeName}, ${lean}`);
  const marketTabs = [{ id: "ALL", label: L("전체", "All") }, ...(day?.groups ?? []).map((g) => ({ id: g.market, label: lang === "ko" ? MARKET_KO[g.market] ?? g.label : MARKET_EN[g.market] ?? g.market }))];

  return (
    <div className="d2 fc" lang={lang}>
      <a className="d2-skip" href="#fc-list">
        {L("본문 바로가기", "Skip to content")}
      </a>
      <Masthead
        rail={false}
        onPrint={() => window.print()}
        section={{ ko: "AI 예측", en: "AI Forecast", taglineKo: "다음 거래일을 먼저 적어 두고, 장이 끝나면 채점합니다", taglineEn: "The next session, written down first and graded after the close" }}
      />

      <div className="d2-cmd fc-bar" data-d2-sticky>
        <div className="d2-cmd-inner fc-bar-inner">
          <div className="fc-dates" role="group" aria-label={L("예측일자", "Forecast date")}>
            <button type="button" className="fc-dates-arrow" onClick={() => older && setSelectedDate(older.date)} disabled={!older} aria-label={L("이전 예측일", "Older")}>
              ‹
            </button>
            <div className="fc-dates-strip">
              {[...dates.slice(0, 10)].reverse().map((d) => (
                <button key={d.date} type="button" className={d.date === day?.date ? "is-on" : ""} aria-pressed={d.date === day?.date} onClick={() => setSelectedDate(d.date)}>
                  <b>{shortDate(d.date)}</b>
                  <small>{d.weekday}</small>
                </button>
              ))}
            </div>
            <button type="button" className="fc-dates-arrow" onClick={() => newer && setSelectedDate(newer.date)} disabled={!newer} aria-label={L("다음 예측일", "Newer")}>
              ›
            </button>
          </div>
          <Marker options={marketTabs} value={market} onChange={setMarket} label={L("시장", "Market")} className="fc-markets" />
          <label className="st-search fc-search">
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
        <section className="d2-sec fc-front" aria-label={L("예보 1면", "Forecast front")}>
          <p className="d2-lead-kicker">
            <span className={`d2-lead-status ${settled ? "" : "is-live"}`}>{settled ? L("채점 완료", "Graded") : L("예측 진행 중", "Open")}</span>
            {day?.date && <span>{formatFullDate(day.date)} ({day.weekday})</span>}
            {day?.generated_at && <span>{L("분석 완료", "Computed")} {formatGeneratedAt(day.generated_at)} KST</span>}
            <span>
              <kbd>←</kbd> <kbd>→</kbd> {L("로 날짜 이동", "to change date")}
            </span>
          </p>
          {showSkel ? (
            <div className="sk-loading">
              <Skel h={44} w="62%" />
              <Skel h={140} />
            </div>
          ) : error ? (
            <p className="d2-empty">{error}</p>
          ) : (
            <>
              <h2 className="fc-head">{headline}</h2>
              <div className="fc-front-grid">
                <div>
                  {totals.total > 0 && (
                    <>
                      <div className="d2-adbar" role="img" aria-label={L(`상승 ${totals.up}, 보합 ${totals.flat}, 하락 ${totals.down}`, `Up ${totals.up}, flat ${totals.flat}, down ${totals.down}`)}>
                        <span className="is-up" style={{ flexGrow: totals.up }}>
                          {L("상승", "Up")} {totals.up}
                        </span>
                        <span className="is-flat" style={{ flexGrow: Math.max(totals.flat, 2) }}>
                          {L("보합", "Flat")} {totals.flat}
                        </span>
                        <span className="is-down" style={{ flexGrow: totals.down }}>
                          {L("하락", "Down")} {totals.down}
                        </span>
                      </div>
                      <dl className="fc-facts">
                        <div>
                          <dt>{L("평균 상승확률", "Avg. up odds")}</dt>
                          <dd>{totals.upProb ?? "—"}%</dd>
                        </div>
                        <div>
                          <dt>{L("평균 예상 등락", "Avg. expected")}</dt>
                          <dd className={`is-${totals.avg > 0 ? "up" : totals.avg < 0 ? "down" : "flat"}`}>{formatChangeRate(totals.avg)}</dd>
                        </div>
                        <div>
                          <dt>{L("평균 신뢰도", "Avg. reliability")}</dt>
                          <dd>{totals.rel ?? "—"}</dd>
                        </div>
                        <div>
                          <dt>{settled ? L("적중률", "Hit rate") : L("채점 현황", "Graded")}</dt>
                          <dd>{totals.graded > 0 ? `${Math.round((totals.hit / totals.graded) * 100)}%` : L("장 마감 후", "after close")}</dd>
                        </div>
                      </dl>
                    </>
                  )}
                  <div className="fc-deck">
                    {day?.iso && countdownMarket && !settled && <Countdown iso={day.iso} market={countdownMarket} />}
                    <p>
                      {L(
                        "예측마다 방향 확률, 신뢰도, 장 마감 설명, 근거 데이터를 함께 적고, 장이 끝나면 실제 시세로 채점해 그 기록을 종목마다 남깁니다.",
                        "Every call carries its odds, its reliability, why the stock closed where it did and the inputs it used; after the session it is graded against the real price and kept on the stock's record."
                      )}
                    </p>
                    <p className="fc-caution">{L("AI 예측은 실제 결과와 다를 수 있습니다. 참고용으로만 보세요.", "Forecasts can be wrong. Read them as reference only.")}</p>
                  </div>
                  {totals.graded > 0 && <Confusion items={scope} />}
                </div>
                <aside className="fc-front-side">
                  {accuracy ? <Scoreboard accuracy={accuracy} /> : <Skel h={160} />}
                  <Link to="/ai-prediction/grading" className="fc-matrix-link">
                    <b>{L("채점 결과 매트릭스", "The grading matrix")}</b>
                    <span>{L("날짜 × 종목으로 모든 예측의 적중 여부를 한 장에", "Every call, stock by session, on one sheet")} →</span>
                  </Link>
                </aside>
              </div>
            </>
          )}
        </section>

        {top3.length >= 2 && !error && (
          <section className="d2-sec fc-top-sec" aria-labelledby="fc-top-h">
            <SectionHead id="fc-top-h" no="01" kicker={L("가장 강한 예측", "Strongest calls")} title={L("AI가 가장 확신한 세 종목", "Where the model leaned hardest")} note={L("방향과 상관없이 종합점수의 크기 순입니다. 누르면 판단 근거 전체가 열립니다.", "Ranked on the size of the score, either way. Open one for the full reasoning.")} />
            <ol className="fc-top">
              {top3.map((it, i) => {
                const d: Dir = dirOf(it.result);
                const p = probabilities(it);
                return (
                  <li key={it.code}>
                    <button type="button" className={`is-${d}`} onClick={() => setOpenCode(it.code)}>
                      <span className="fc-top-no">{String(i + 1).padStart(2, "0")}</span>
                      <span className="fc-top-name">
                        <b>{it.name}</b>
                        <small>
                          {MARKET_KO[it.market] ?? it.market} · {it.code}
                        </small>
                      </span>
                      <span className="fc-top-fig">
                        <Verdict result={it.result} size="lg" />
                        <em className={`d2-num is-${d}`}>{formatChangeRate(it.change_rate)}</em>
                      </span>
                      <ProbBar item={it} labels={false} />
                      <span className="fc-top-foot">
                        {p ? L(`상승확률 ${p.up}%`, `Up ${p.up}%`) : L(`확신도 ${it.confidence}`, `Conviction ${it.confidence}`)}
                        {it.reliability_grade && ` · ${L("신뢰도", "rel.")} ${it.reliability_grade}`}
                        <i>→</i>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        <section id="fc-list" className="d2-sec" aria-labelledby="fc-list-h">
          <SectionHead
            id="fc-list-h"
            no={top3.length >= 2 ? "02" : "01"}
            kicker={L("종목별 예보", "Every call")}
            title={L("시장별 다음 거래일 예측", "The next session, market by market")}
            note={L(`${groups.reduce((s, g) => s + g.items.length, 0)}종목 표시 · 카드를 누르면 상세가 열리고, 상세에서 ← →로 다음 종목으로 넘어갑니다.`, `${groups.reduce((s, g) => s + g.items.length, 0)} shown · open a card, then ← → to walk the list.`)}
          />
          <div className="fc-controls">
            <Marker options={SORTS.map((s) => ({ id: s.id, label: L(s.ko, s.en) }))} value={sort} onChange={setSort} label={L("정렬", "Order")} className="fc-sorts" />
            <div className="fc-controls-right">
              {totals.graded > 0 && (
                <div className="sk-seg" role="group" aria-label={L("채점 결과", "Outcome")}>
                  {(["all", "hit", "miss"] as Outcome[]).map((o) => (
                    <button key={o} type="button" className={outcome === o ? "is-on" : ""} aria-pressed={outcome === o} onClick={() => setOutcome(o)}>
                      {o === "all" ? L("전체", "All") : o === "hit" ? L("적중", "Hits") : L("빗나감", "Misses")}
                    </button>
                  ))}
                </div>
              )}
              {totals.weak > 0 && (
                <button type="button" className={`fc-toggle ${hideWeak ? "is-on" : ""}`} aria-pressed={hideWeak} onClick={() => setHideWeak((v) => !v)}>
                  {L(`신뢰도 낮음 ${totals.weak}건 숨기기`, `Hide ${totals.weak} low-reliability`)}
                </button>
              )}
              <div className="sk-seg" role="group" aria-label={L("보기", "View")}>
                <button type="button" className={view === "card" ? "is-on" : ""} aria-pressed={view === "card"} onClick={() => setView("card")}>
                  {L("카드", "Cards")}
                </button>
                <button type="button" className={view === "table" ? "is-on" : ""} aria-pressed={view === "table"} onClick={() => setView("table")}>
                  {L("표", "Table")}
                </button>
              </div>
            </div>
          </div>

          {elsewhere.length > 0 && (
            <p className="fc-elsewhere">
              {elsewhere.map((m) => (
                <button
                  key={m.market}
                  type="button"
                  onClick={() => {
                    setMarket("ALL");
                    setSelectedDate(m.date.date);
                  }}
                >
                  {L(`${MARKET_KO[m.market] ?? m.market} 예측은 ${m.date.label}자에 있습니다`, `${MARKET_EN[m.market] ?? m.market} is on ${m.date.label}`)} →
                </button>
              ))}
              <span>{L("한국장은 15:30 KST, 미국장은 16:00 ET에 마감해 두 배치의 예측일이 서로 다를 수 있습니다.", "Seoul closes at 15:30 KST and New York at 16:00 ET, so the two batches can target different days.")}</span>
            </p>
          )}

          <div className={loading && loadedOnce.current ? "fc-body is-refreshing" : "fc-body"}>
            {showSkel && (
              <div className="fc-grid">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skel key={i} h={300} />
                ))}
              </div>
            )}
            {!showSkel && !error && groups.length === 0 && (
              <p className="d2-empty">
                {hideWeak || outcome !== "all" || query
                  ? L("조건에 맞는 종목이 없습니다. 필터를 풀어 보세요.", "Nothing matches. Try loosening the filters.")
                  : L("선택한 날짜에 예측 데이터가 없습니다. 배치는 평일 밤, 한국장·뉴욕장 각각 따로 실행됩니다.", "No calls on this date. The batches run on weekday nights, one per market.")}
              </p>
            )}
            {groups.map((g) => {
              const open = expanded[g.market] || g.items.length <= GROUP_PAGE;
              const shown = open ? g.items : g.items.slice(0, GROUP_PAGE);
              const hidden = g.items.length - shown.length;
              const dist = g.summary.up + g.summary.flat + g.summary.down || 1;
              const ctx = (() => {
                for (const it of g.items) {
                  const index = it.evidence.find((e) => e.category === "업종지수");
                  const fx = it.evidence.find((e) => e.category === "환율");
                  if (index || fx) return { index, fx };
                }
                return null;
              })();
              return (
                <section key={g.market} className="fc-group" aria-labelledby={`fc-g-${g.market}`}>
                  <header className="fc-group-head">
                    <h3 id={`fc-g-${g.market}`}>
                      {lang === "ko" ? MARKET_KO[g.market] ?? g.label : MARKET_EN[g.market] ?? g.market}
                      <small>
                        {g.items.length}
                        {L("종목", "")}
                      </small>
                    </h3>
                    <span className="fc-group-dist" aria-hidden="true">
                      <i className="is-up" style={{ width: `${(g.summary.up / dist) * 100}%` }} />
                      <i className="is-flat" style={{ width: `${(g.summary.flat / dist) * 100}%` }} />
                      <i className="is-down" style={{ width: `${(g.summary.down / dist) * 100}%` }} />
                    </span>
                    <p>
                      <span className="is-up">
                        {L("상승", "Up")} {g.summary.up}
                      </span>
                      <span className="is-flat">
                        {L("보합", "Flat")} {g.summary.flat}
                      </span>
                      <span className="is-down">
                        {L("하락", "Down")} {g.summary.down}
                      </span>
                      <span>
                        {L("평균", "Avg.")} {formatChangeRate(g.summary.avg_change_rate)}
                      </span>
                      {g.summary.avg_reliability !== null && (
                        <span>
                          {L("신뢰도", "Rel.")} {g.summary.avg_reliability}
                        </span>
                      )}
                      {g.summary.graded > 0 && (
                        <span className={g.summary.hit / g.summary.graded >= 0.5 ? "is-good" : "is-bad"}>
                          {L("적중", "Hits")} {g.summary.hit}/{g.summary.graded}
                        </span>
                      )}
                      {g.items[0] && (
                        <span className="d2-muted">
                          {L("수집", "From")} {shortDate(g.items[0].collect_date)}
                        </span>
                      )}
                    </p>
                  </header>
                  {ctx && (
                    <p className="fc-context">
                      {ctx.index && (
                        <span>
                          <b>{ctx.index.label}</b> {ctx.index.value}
                        </span>
                      )}
                      {ctx.fx && (
                        <span>
                          <b>{ctx.fx.label}</b> {ctx.fx.value}
                        </span>
                      )}
                    </p>
                  )}
                  {view === "table" ? (
                    <Rows items={shown} rankOf={rankOf} onOpen={(it) => setOpenCode(it.code)} />
                  ) : (
                    <div className="fc-grid">
                      {shown.map((it) => (
                        <Card key={it.code} item={it} rank={rankOf.get(it.code)} onOpen={() => setOpenCode(it.code)} />
                      ))}
                    </div>
                  )}
                  {hidden > 0 && (
                    <button type="button" className="fc-more" onClick={() => setExpanded((p) => ({ ...p, [g.market]: true }))}>
                      {L(`나머지 ${hidden}종목 더 보기`, `${hidden} more`)} ↓
                    </button>
                  )}
                  {open && expanded[g.market] && (
                    <button type="button" className="fc-more" onClick={() => setExpanded((p) => ({ ...p, [g.market]: false }))}>
                      {L("접기", "Fold")} ↑
                    </button>
                  )}
                </section>
              );
            })}
          </div>

          <p className="sk-disclaimer">
            {L(
              "이 예측은 공개된 시세·지표·언론 데이터에 기반한 AI의 통계적 추정이며 투자 자문이나 매매 권유가 아닙니다. 투자 판단과 그 결과의 책임은 투자자 본인에게 있습니다.",
              "Statistical estimates from public prices, indicators and news — not investment advice."
            )}
          </p>
        </section>
      </main>

      <Colophon />
      <Finder open={finderOpen} onClose={() => setFinderOpen(false)} />
      {openItem && <ForecastReader item={openItem} onClose={() => setOpenCode(null)} onStep={step} />}
    </div>
  );
}
