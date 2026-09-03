import { useEffect, useMemo, useRef, useState } from "react";
import { BoardPost, MarketMapItem, StockDiscussionGroup, StockSearchResult, api } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link, navigate } from "../router";
import { useMarketSnapshot } from "../useMarketSnapshot";
import StockLogo from "./StockLogo";

/* 실시간 인기 종목 토론 — the band under 수급 · 순위.
 *
 * A row of chips, one per stock the day is actually about, and under the selected
 * chip that stock's quote and the newest posts on its board. Reading discussion by
 * stock rather than as one undifferentiated feed is the whole point: a post title
 * means nothing without knowing which name it is about, and a reader browsing "what
 * are people arguing about today" wants to move between names, not scroll one list.
 *
 * Which stocks. Two sources, in this order: what this site's own visitors are
 * searching for right now (/search/popular — the closest thing here to an issue
 * ranking, and it is ours rather than inferred), then the day's largest 거래대금
 * names from the snapshot the desk already holds, to fill the row on a quiet morning
 * before the search log has said anything. KR only — the board endpoint underneath is
 * Naver's stock discussion board, which has no US side.
 *
 * Every chip's posts arrive in one batched request (see /stock/discussions), so
 * switching chips is instant and costs nothing. Posts refresh on the board fetcher's
 * own cadence; quotes ride along on the desk's existing snapshot.
 */

/** Chips beyond this stop being a row a thumb can flick through and start being a
 * list. Also the endpoint's own ceiling. */
const CHIPS = 8;
/** Keep a substantial scrollable history behind the rolling list for each stock. */
const POSTS = 30;
/** The board fetcher caches each code for three minutes upstream, so polling faster
 * than that only re-serves the same posts. */
const REFRESH_MS = 180_000;
const ROLL_MS = 4_500;

type TalkStock = { code: string; name: string };

/** Newest first. Naver's board dates arrive as "MM.DD HH:mm" within the current year
 * and "YY.MM.DD" once they roll past it — shown as they come rather than reformatted,
 * because that is the form the same date has on the stock's own board page and two
 * spellings of one timestamp across two surfaces is worse than a terse one. */
function postDate(post: BoardPost): string {
  return post.date?.trim() || "";
}

function toneOf(changePct: number | undefined): "up" | "down" | "flat" {
  if (changePct === undefined) return "flat";
  return changePct > 0 ? "up" : changePct < 0 ? "down" : "flat";
}

export default function DeskTalkBoard({
  onSelectStock,
}: {
  onSelectStock: (stock: StockSearchResult) => void;
}) {
  const t = useT();
  const snapshot = useMarketSnapshot();
  const [popular, setPopular] = useState<TalkStock[]>([]);
  const [groups, setGroups] = useState<Record<string, StockDiscussionGroup>>({});
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const postsRef = useRef<HTMLUListElement>(null);
  const rollPaused = useRef(false);

  const scrollPosts = (direction: -1 | 1) => {
    const list = postsRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(".desk-talk-post");
    list.scrollBy({ top: direction * (row?.offsetHeight ?? 72), behavior: "smooth" });
  };

  // Every KR name the desk already holds a quote for, so a chip can show its move
  // without a second request per stock.
  const quotes = useMemo(() => {
    const byCode = new Map<string, MarketMapItem>();
    for (const item of [...snapshot.kospi, ...snapshot.kosdaq]) byCode.set(item.code, item);
    return byCode;
  }, [snapshot.kospi, snapshot.kosdaq]);

  const turnoverTop = useMemo<TalkStock[]>(
    () =>
      [...snapshot.kospi, ...snapshot.kosdaq]
        .map((item) => ({ item, turnover: item.turnover ?? (item.volume ?? 0) * item.close }))
        .filter((row) => row.turnover > 0)
        .sort((a, b) => b.turnover - a.turnover)
        .slice(0, CHIPS)
        .map((row) => ({ code: row.item.code, name: row.item.name })),
    [snapshot.kospi, snapshot.kosdaq],
  );

  useEffect(() => {
    let cancelled = false;
    api
      .popularSearches(CHIPS, "KR")
      .then((res) => {
        if (cancelled) return;
        setPopular(res.items.map((item) => ({ code: item.code, name: item.name })));
      })
      .catch(() => {
        // The turnover fallback below covers this entirely — an empty search log is
        // the ordinary state of a quiet morning, not a failure worth showing.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* The chip row. Search log first, turnover after, deduplicated, capped — and only
     KRX codes, because the board underneath has no US side. */
  const stocks = useMemo<TalkStock[]>(() => {
    const picked: TalkStock[] = [];
    const seen = new Set<string>();
    for (const stock of [...popular, ...turnoverTop]) {
      if (picked.length >= CHIPS) break;
      if (!/^\d[0-9A-Z]{5}$/i.test(stock.code) || seen.has(stock.code)) continue;
      seen.add(stock.code);
      picked.push(stock);
    }
    return picked;
  }, [popular, turnoverTop]);

  /* Refetched only when the chip row's membership actually changes, not on every
     snapshot tick — the turnover ranking reorders constantly during a session and
     re-pulling eight boards for a swapped pair of ranks is pure waste. */
  const codeKey = stocks.map((stock) => stock.code).sort().join(",");

  useEffect(() => {
    if (!codeKey) return;
    let cancelled = false;
    const codes = codeKey.split(",");

    const load = (isInitial: boolean) => {
      if (isInitial) setLoading(true);
      api
        .stockDiscussions(codes, POSTS)
        .then((res) => {
          if (cancelled) return;
          setGroups(res.items);
        })
        .catch(() => {
          // Keeps whatever is already drawn. The band is context; a failed refresh
          // must not empty it.
        })
        .finally(() => {
          if (isInitial && !cancelled) setLoading(false);
        });
    };

    load(true);
    const stop = startVisibilityAwareInterval(() => load(false), REFRESH_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [codeKey]);

  /* A reordering chip row must not move the panel out from under a reader: the chosen
     stock is kept for as long as it is still in the row, and only a stock that has
     left it falls back to the first chip. The row itself reorders on every snapshot
     tick, so "follow the top chip" would be a panel that changes on its own. */
  useEffect(() => {
    if (stocks.length === 0) return;
    setActive((current) =>
      current && stocks.some((stock) => stock.code === current) ? current : stocks[0].code,
    );
  }, [stocks]);

  const activeStock = stocks.find((stock) => stock.code === active) ?? stocks[0] ?? null;
  const activeGroup = activeStock ? groups[activeStock.code] : undefined;
  const activeQuote = activeStock ? quotes.get(activeStock.code) : undefined;
  const chipNames = useTranslatedTexts(stocks.map((stock) => stock.name));
  const activeName = activeStock
    ? chipNames[stocks.findIndex((stock) => stock.code === activeStock.code)] ??
      activeGroup?.name ??
      activeStock.name
    : "";
  const posts = activeGroup?.posts ?? [];

  useEffect(() => {
    if (posts.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const stop = startVisibilityAwareInterval(() => {
      const list = postsRef.current;
      if (!list || rollPaused.current) return;
      const row = list.querySelector<HTMLElement>(".desk-talk-post");
      const step = row?.offsetHeight ?? 72;
      const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
      list.scrollTo({ top: atEnd ? 0 : Math.min(list.scrollTop + step, list.scrollHeight), behavior: "smooth" });
    }, ROLL_MS);
    return stop;
  }, [activeStock?.code, posts.length]);

  useEffect(() => {
    postsRef.current?.scrollTo({ top: 0 });
  }, [activeStock?.code]);

  /** Where a discussion click goes. The explorer is this site's discussion surface and
   * takes the stock as a query parameter — the same destination the detail pages'
   * LIVE TALK ticker uses, so a post opened from the desk lands where a post opened
   * from anywhere else does. */
  const explorerHref = activeStock
    ? `/discussion-explorer?code=${encodeURIComponent(activeStock.code)}&name=${encodeURIComponent(
        activeStock.name,
      )}&market=KR&asset=STOCK`
    : "/discussion-explorer";

  const postHref = (nid: string) => `${explorerHref}&nid=${encodeURIComponent(nid)}`;

  const tone = toneOf(activeQuote?.change_pct);

  return (
    <div className="desk-talk">
      <div className="desk-talk-head">
        <h3>{t("실시간 인기 종목 토론")}</h3>
      </div>

      {/* Horizontally scrollable on every width, snapping on touch — eight company
          names cannot wrap onto one line on a phone and a wrapped chip row pushes the
          posts themselves off the screen. */}
      <div className="desk-talk-chips" role="tablist" aria-label={t("종목 선택")}>
        {stocks.length === 0
          ? Array.from({ length: 5 }, (_, index) => (
              <span key={`chip-skeleton-${index}`} className="desk-talk-chip is-skeleton" aria-hidden="true">
                <span className="skeleton" style={{ width: 54, height: 13 }} />
              </span>
            ))
          : stocks.map((stock, index) => {
              const quote = quotes.get(stock.code);
              const chipTone = toneOf(quote?.change_pct);
              return (
                <button
                  key={stock.code}
                  type="button"
                  role="tab"
                  aria-selected={stock.code === activeStock?.code}
                  className={`desk-talk-chip ${stock.code === activeStock?.code ? "is-on" : ""}`}
                  onClick={() => setActive(stock.code)}
                >
                  <StockLogo code={stock.code} name={stock.name} className="desk-talk-chip-logo" />
                  <b>{chipNames[index] ?? stock.name}</b>
                  {quote && (
                    <small className={`change-${chipTone}`}>
                      {quote.change_pct >= 0 ? "+" : ""}
                      {quote.change_pct.toFixed(2)}%
                    </small>
                  )}
                </button>
              );
            })}
      </div>

      <div
        className="desk-talk-panel"
        role="tabpanel"
        aria-live="polite"
        aria-busy={loading}
      >
        {activeStock && (
          <div className="desk-talk-stock">
            <button
              type="button"
              className="desk-talk-stock-id"
              onClick={() =>
                onSelectStock({
                  code: activeStock.code,
                  name: activeStock.name,
                  market: snapshot.kosdaq.some((item) => item.code === activeStock.code)
                    ? "KOSDAQ"
                    : "KOSPI",
                })
              }
              title={t("이 종목을 작업 영역에서 열기")}
            >
              <StockLogo code={activeStock.code} name={activeStock.name} className="desk-talk-stock-logo" />
              <span>
                <b>{activeName}</b>
                <small>{activeStock.code}</small>
              </span>
            </button>
            {activeQuote && (
              <span className="desk-talk-stock-quote">
                <b>{activeQuote.close.toLocaleString()}</b>
                <small className={`change-${tone}`}>
                  {activeQuote.change_pct >= 0 ? "+" : ""}
                  {activeQuote.change_pct.toFixed(2)}%
                </small>
              </span>
            )}
            <Link className="desk-talk-more" to={explorerHref}>
              {t("토론방 가기")} →
            </Link>
            {posts.length > 1 && (
              <span className="desk-talk-scroll-controls" aria-label={t("토론 글 넘기기")}>
                <button type="button" onClick={() => scrollPosts(-1)} aria-label={t("이전 토론 글")}>
                  ↑
                </button>
                <button type="button" onClick={() => scrollPosts(1)} aria-label={t("다음 토론 글")}>
                  ↓
                </button>
              </span>
            )}
          </div>
        )}

        {loading && posts.length === 0 ? (
          <ul className="desk-talk-posts" aria-hidden="true">
            {Array.from({ length: POSTS }, (_, index) => (
              <li key={`post-skeleton-${index}`} className="desk-talk-post is-skeleton">
                <span className="skeleton" style={{ height: 14 }} />
                <span className="skeleton" style={{ height: 10, width: "58%" }} />
              </li>
            ))}
          </ul>
        ) : posts.length === 0 ? (
          <p className="desk-talk-empty">{t("아직 등록된 토론 글이 없습니다.")}</p>
        ) : (
          <div className="desk-talk-list-shell">
            <ul
              className="desk-talk-posts"
              ref={postsRef}
              aria-label={t("자동으로 롤링되는 최신 종목 토론")}
              onMouseEnter={() => { rollPaused.current = true; }}
              onMouseLeave={() => { rollPaused.current = false; }}
              onFocus={() => { rollPaused.current = true; }}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) rollPaused.current = false;
              }}
            >
              {posts.map((post) => (
                <li key={post.nid} className="desk-talk-post">
                  <button type="button" onClick={() => navigate(postHref(post.nid))}>
                    <strong>{post.title}</strong>
                    <span className="desk-talk-post-meta">
                      <i>{post.author}</i>
                      <time>{postDate(post)}</time>
                    </span>
                    <span className="desk-talk-post-stats">
                      <em>{t("조회")} {post.views.toLocaleString()}</em>
                      <em className="is-like">{t("공감")} {post.likes.toLocaleString()}</em>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <span className="desk-talk-list-fade" aria-hidden="true" />
          </div>
        )}
      </div>
    </div>
  );
}
