import { useEffect, useMemo, useRef, useState } from "react";
import { MarketMapItem, StockDiscussionGroup, StockQuote, api } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link, navigate } from "../router";
import { useMarketSnapshot } from "../useMarketSnapshot";
import { usePopularStocks } from "../usePopularStocks";
import { useWatchlist } from "../useWatchlist";
import { clearRecents } from "../watchlist";
import StockLogo from "../components/StockLogo";
import { Marker, Skel } from "./parts";
import { krwPrice, openStock, pct, toneOf, turnoverOf, usdPrice, useL } from "./lib";

/* 06 레이더 · 07 토론방 — the room.
 *
 * Two different answers to "what are people looking at": the crowd's most
 * viewed names on this site with a live price against each, and — for the
 * names the day is about — the newest posts on their boards. They sit side by
 * side because the second is the first with the argument attached. */

const RADAR_ROWS = 8;

/** Board timestamps arrive either as Naver's own "MM.DD HH:mm" or as an ISO
 * string; both are set as "HH:mm" for today and "MM.DD HH:mm" otherwise. */
function postTime(raw: string): string {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!iso) return raw.trim();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const [, y, m, d, hh, mm] = iso;
  return `${y}-${m}-${d}` === today ? `${hh}:${mm}` : `${m}.${d} ${hh}:${mm}`;
}
const RADAR_POLL_MS = 15_000;

export function Radar() {
  const { lang } = useLanguage();
  const L = useL();
  const [mode, setMode] = useState<"popular" | "recents">("popular");
  const popular = usePopularStocks(RADAR_ROWS);
  const { recents } = useWatchlist();
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});

  const rows =
    mode === "popular"
      ? (popular ?? []).slice(0, RADAR_ROWS).map((p, i) => ({ code: p.code, name: p.name, market: p.market, rank: i + 1, count: p.count }))
      : recents.slice(0, RADAR_ROWS).map((r) => ({ code: r.code, name: r.name, market: r.market, rank: null as number | null, count: null as number | null }));
  const names = useTranslatedTexts(rows.map((r) => r.name));
  const quoteKey = rows.map((r) => `${r.market === "US" ? "US" : "KR"}:${r.code}`).join(",");

  useEffect(() => {
    if (!quoteKey) return;
    const targets = quoteKey.split(",").map((e) => {
      const [side, code] = e.split(":");
      return { code, us: side === "US" };
    });
    let cancelled = false;
    const poll = () => {
      for (const t of targets) {
        (t.us ? api.usStockQuote(t.code) : api.quote(t.code))
          .then((q) => {
            if (!cancelled) setQuotes((prev) => ({ ...prev, [t.code]: q as StockQuote }));
          })
          .catch(() => {});
      }
    };
    poll();
    const stop = startVisibilityAwareInterval(poll, RADAR_POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [quoteKey]);

  const maxCount = Math.max(1, ...rows.map((r) => r.count ?? 0));
  const loading = mode === "popular" && popular === null;

  return (
    <div className="d2-radar">
      <div className="d2-block-head">
        <Marker
          options={[
            { id: "popular", label: L("지금 많이 보는", "Most viewed") },
            { id: "recents", label: L("내가 본 종목", "My recent") },
          ]}
          value={mode}
          onChange={setMode}
          label={L("종목 레이더", "Stock radar")}
        />
        {mode === "recents" && recents.length > 0 && (
          <button type="button" className="d2-text-btn" onClick={clearRecents}>
            {L("기록 삭제", "Clear")}
          </button>
        )}
      </div>
      {loading ? (
        <ul className="d2-radar-list">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i}>
              <Skel h={18} />
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <p className="d2-empty">
          {mode === "popular" ? L("아직 집계된 인기 종목이 없습니다.", "No popular names yet.") : L("살펴본 종목이 여기에 쌓입니다.", "Stocks you open will collect here.")}
        </p>
      ) : (
        <ul className="d2-radar-list">
          {rows.map((r, i) => {
            const q = quotes[r.code];
            const tone = toneOf(q?.change_pct);
            return (
              <li key={r.code}>
                <button type="button" className={`is-${tone}`} onClick={() => openStock({ code: r.code, name: r.name, market: r.market })}>
                  <span className="d2-radar-rank">{r.rank ?? "·"}</span>
                  <StockLogo code={r.code} name={r.name} className="d2-radar-logo" />
                  <span className="d2-radar-name">
                    <b>{names[i] ?? r.name}</b>
                    {r.count !== null && (
                      <i className="d2-radar-heat" aria-hidden="true">
                        <i style={{ width: `${(r.count / maxCount) * 100}%` }} />
                      </i>
                    )}
                  </span>
                  {q ? (
                    <span className="d2-radar-fig">
                      <b>{r.market === "US" ? usdPrice(q.close) : krwPrice(q.close, lang)}</b>
                      <small>{pct(q.change_pct)}</small>
                    </span>
                  ) : (
                    <Skel w={70} h={14} />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ── discussion ─────────────────────────────────────────────────────────── */

const CHIPS = 8;
const POSTS = 30;
const TALK_REFRESH_MS = 180_000;
const ROLL_MS = 4_500;

export function Talk() {
  const L = useL();
  const snapshot = useMarketSnapshot();
  const [popular, setPopular] = useState<{ code: string; name: string }[]>([]);
  const [groups, setGroups] = useState<Record<string, StockDiscussionGroup>>({});
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const listRef = useRef<HTMLOListElement>(null);
  const paused = useRef(false);

  const quotes = useMemo(() => {
    const m = new Map<string, MarketMapItem>();
    for (const it of [...snapshot.kospi, ...snapshot.kosdaq]) m.set(it.code, it);
    return m;
  }, [snapshot.kospi, snapshot.kosdaq]);

  const turnoverTop = useMemo(
    () =>
      [...snapshot.kospi, ...snapshot.kosdaq]
        .filter((it) => turnoverOf(it) > 0)
        .sort((a, b) => turnoverOf(b) - turnoverOf(a))
        .slice(0, CHIPS)
        .map((it) => ({ code: it.code, name: it.name })),
    [snapshot.kospi, snapshot.kosdaq]
  );

  useEffect(() => {
    let cancelled = false;
    api
      .popularSearches(CHIPS, "KR")
      .then((res) => !cancelled && setPopular(res.items.map((i) => ({ code: i.code, name: i.name }))))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const stocks = useMemo(() => {
    const picked: { code: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const s of [...popular, ...turnoverTop]) {
      if (picked.length >= CHIPS) break;
      if (!/^\d[0-9A-Z]{5}$/i.test(s.code) || seen.has(s.code)) continue;
      seen.add(s.code);
      picked.push(s);
    }
    return picked;
  }, [popular, turnoverTop]);

  const codeKey = stocks.map((s) => s.code).sort().join(",");
  useEffect(() => {
    if (!codeKey) return;
    let cancelled = false;
    const load = (first: boolean) => {
      if (first) setLoading(true);
      api
        .stockDiscussions(codeKey.split(","), POSTS)
        .then((res) => !cancelled && setGroups(res.items))
        .catch(() => {})
        .finally(() => {
          if (first && !cancelled) setLoading(false);
        });
    };
    load(true);
    const stop = startVisibilityAwareInterval(() => load(false), TALK_REFRESH_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [codeKey]);

  useEffect(() => {
    if (stocks.length === 0) return;
    setActive((cur) => (cur && stocks.some((s) => s.code === cur) ? cur : stocks[0].code));
  }, [stocks]);

  const activeStock = stocks.find((s) => s.code === active) ?? stocks[0] ?? null;
  const chipNames = useTranslatedTexts(stocks.map((s) => s.name));
  const posts = activeStock ? groups[activeStock.code]?.posts ?? [] : [];
  const activeQuote = activeStock ? quotes.get(activeStock.code) : undefined;

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [activeStock?.code]);

  useEffect(() => {
    if (posts.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    return startVisibilityAwareInterval(() => {
      const list = listRef.current;
      if (!list || paused.current) return;
      const step = list.querySelector<HTMLElement>("li")?.offsetHeight ?? 64;
      const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
      list.scrollTo({ top: atEnd ? 0 : list.scrollTop + step, behavior: "smooth" });
    }, ROLL_MS);
  }, [activeStock?.code, posts.length]);

  const scrollBy = (dir: 1 | -1) => {
    const list = listRef.current;
    if (!list) return;
    const step = list.querySelector<HTMLElement>("li")?.offsetHeight ?? 64;
    list.scrollBy({ top: dir * step, behavior: "smooth" });
  };

  const explorer = activeStock
    ? `/discussion-explorer?code=${encodeURIComponent(activeStock.code)}&name=${encodeURIComponent(activeStock.name)}&market=KR&asset=STOCK`
    : "/discussion-explorer";

  return (
    <div className="d2-talk">
      <div className="d2-talk-chips" role="tablist" aria-label={L("종목 선택", "Choose a stock")}>
        {stocks.length === 0
          ? Array.from({ length: 5 }, (_, i) => <Skel key={i} w={88} h={30} />)
          : stocks.map((s, i) => {
              const q = quotes.get(s.code);
              return (
                <button
                  key={s.code}
                  type="button"
                  role="tab"
                  aria-selected={s.code === activeStock?.code}
                  className={s.code === activeStock?.code ? "is-on" : ""}
                  onClick={() => setActive(s.code)}
                >
                  <b>{chipNames[i] ?? s.name}</b>
                  {q && <small className={`is-${toneOf(q.change_pct)}`}>{pct(q.change_pct)}</small>}
                </button>
              );
            })}
      </div>

      {activeStock && (
        <div className="d2-talk-head">
          <button
            type="button"
            className="d2-talk-id"
            onClick={() => openStock({ code: activeStock.code, name: activeStock.name, market: "KOSPI" })}
          >
            <StockLogo code={activeStock.code} name={activeStock.name} className="d2-talk-logo" />
            <span>
              <b>{chipNames[stocks.indexOf(activeStock)] ?? activeStock.name}</b>
              <small>{activeStock.code}</small>
            </span>
          </button>
          {activeQuote && (
            <span className={`d2-talk-quote is-${toneOf(activeQuote.change_pct)}`}>
              <b>{activeQuote.close.toLocaleString()}</b>
              <small>{pct(activeQuote.change_pct)}</small>
            </span>
          )}
          <span className="d2-talk-tools">
            {posts.length > 1 && (
              <>
                <button type="button" onClick={() => scrollBy(-1)} aria-label={L("이전 글", "Previous post")}>
                  ↑
                </button>
                <button type="button" onClick={() => scrollBy(1)} aria-label={L("다음 글", "Next post")}>
                  ↓
                </button>
              </>
            )}
            <Link to={explorer} className="d2-more">
              {L("토론방", "Board")} →
            </Link>
          </span>
        </div>
      )}

      {loading && posts.length === 0 ? (
        <ol className="d2-talk-posts" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i}>
              <Skel h={15} />
              <Skel h={11} w="45%" />
            </li>
          ))}
        </ol>
      ) : posts.length === 0 ? (
        <p className="d2-empty">{L("아직 등록된 토론 글이 없습니다.", "No posts yet.")}</p>
      ) : (
        <ol
          className="d2-talk-posts"
          ref={listRef}
          aria-label={L("자동으로 넘어가는 최신 토론 글", "Latest posts, auto-scrolling")}
          onMouseEnter={() => (paused.current = true)}
          onMouseLeave={() => (paused.current = false)}
          onFocus={() => (paused.current = true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) paused.current = false;
          }}
          onTouchStart={() => (paused.current = true)}
        >
          {posts.map((p) => (
            <li key={p.nid}>
              <button type="button" onClick={() => navigate(`${explorer}&nid=${encodeURIComponent(p.nid)}`)}>
                <strong>{p.title}</strong>
                <span>
                  <i>{p.author}</i>
                  <time>{postTime(p.date)}</time>
                  <em>
                    {L("조회", "views")} {p.views.toLocaleString()}
                  </em>
                  <em className="is-like">
                    {L("공감", "likes")} {p.likes.toLocaleString()}
                  </em>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
