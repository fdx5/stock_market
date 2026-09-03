import { useEffect, useState } from "react";
import { BoardDetail, BoardPost, GlobalDiscussionPost, api } from "../api/client";
import { shortDateTime } from "../stocks/market";
import { reportMarketOrbitEvent, reportStocksEvent } from "../useActivityTracking";

/* 종목토론 for one stock, from whichever board its market has.
 *
 * KRX names read Naver's 종목토론실; US names read Toss Securities' board, because
 * Naver has no 종목토론실 for AAPL and its 해외종목 토론방 ("global") is far quieter
 * than where Korean retail actually discusses these names. The two paginate on
 * different principles — Naver by page number, Toss by an opaque cursor — and the
 * shape below is what lets one list,
 * one detail view and one prev/next control serve both: posts are normalised to
 * `DiscussionPost`, and paging state is a stack of cursors where entry N is what to
 * send to reach page N+1. For Naver the cursor is unused and the page number is
 * enough; for Toss it is the whole mechanism.
 *
 * The detail view is deliberately in-panel rather than a modal. A modal over a page
 * whose left half is a live-updating list would cover the thing the reader is
 * comparing against, and 이전글/다음글 only make sense as a continuation of the list
 * they came from.
 */

interface DiscussionPost {
  id: string;
  title: string;
  /** Toss posts carry their body in the list response; Naver's need a second fetch. */
  preview: string;
  author: string;
  date: string;
  views: number;
  likes: number;
}

const PAGE_SIZE = 10;

/** A Naver 종목토론실 page this full means another one follows.
 *
 * Its pages hold 20, and the panel shows half of one at a time. The line sits well
 * below 20 because the fetch de-duplicates clustered reposts, so a middle page routinely
 * arrives with 18 or 19 rows and must not be read as the end of the board; a real last
 * page comes back with a handful. Naver publishes no page count, so this is the only
 * signal available short of fetching the next page to find out. */
const NAVER_MORE_HINT = 15;

function fromNaver(post: BoardPost): DiscussionPost {
  return {
    id: post.nid,
    title: post.title,
    preview: "",
    author: post.author,
    date: post.date,
    views: post.views,
    likes: post.likes,
  };
}

function fromGlobal(post: GlobalDiscussionPost): DiscussionPost {
  return {
    id: post.id,
    // Toss posts are often bodies with no title of their own; the opening line stands
    // in, because a list of "(제목 없음)" is a list nobody can choose from.
    title: post.title?.trim() || post.text.slice(0, 60),
    preview: post.text,
    author: post.author,
    date: post.written_at,
    views: post.views,
    likes: post.likes,
  };
}

interface Props {
  code: string;
  name: string;
  market: string;
  source: "naver" | "global" | "toss";
  trackingContext?: "stocks" | "orbit";
}

export default function StockDiscussionTab({ code, name, market, source, trackingContext = "stocks" }: Props) {
  // Both overseas boards return the post body inline; only Naver's needs a second
  // fetch to read one. Everything that used to branch on "is this the global board"
  // was really asking this.
  const bodyArrivesWithList = source !== "naver";
  const [posts, setPosts] = useState<DiscussionPost[]>([]);
  const [page, setPage] = useState(1);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [detail, setDetail] = useState<BoardDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Set when 이전글/다음글 runs off the end of the page being read, and consumed by the
  // fetch below: it says "when the next page lands, open it at this end" and is what
  // carries the reader across a page boundary without returning to the list.
  const [pendingOpen, setPendingOpen] = useState<"first" | "last" | null>(null);

  // A new stock is a new board: everything about the previous one, including which
  // page of it was open, is meaningless here.
  useEffect(() => {
    setPage(1);
    setCursors([null]);
    setOpenIndex(null);
    setDetail(null);
    setPendingOpen(null);
  }, [code, source]);

  /** Opens a post from an explicit list rather than from `posts` state.
   *
   * The list is a parameter because the page-crossing path calls this from inside the
   * fetch that produced it, where the state setter has not been applied yet. */
  const openFrom = (list: DiscussionPost[], index: number) => {
    const post = list[index];
    if (!post) return;
    // Reported for the post itself, not for "a click in the discussion tab": the admin
    // ranking is meant to answer which conversations pull readers in.
    if (trackingContext === "orbit")
      reportMarketOrbitEvent({ action: "discussion_post", market, code, name, detail: post.title });
    else reportStocksEvent({ action: "discussion_post", market, code, name, detail: post.title });
    setOpenIndex(index);
    setDetail(null);
    // Toss and Naver-global posts arrive whole; only Naver's 종목토론실 needs a fetch.
    if (bodyArrivesWithList) return;
    setDetailLoading(true);
    api
      .boardDetail(code, post.id)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  };

  const open = (index: number) => openFrom(posts, index);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    const cursor = cursors[page - 1] ?? null;
    const request =
      source === "toss"
        ? api.tossDiscussion(code, PAGE_SIZE, cursor)
        : source === "global"
          ? api.globalDiscussion(code, PAGE_SIZE, cursor)
          : // Naver serves 20 posts per page; the panel shows 10, so two panel pages are
            // carved out of each fetched page rather than fetching twice as often.
            api.board(code, Math.floor((page - 1) / 2) + 1, page === 1);

    request
      .then((result) => {
        if (cancelled) return;
        let list: DiscussionPost[];
        if ("next_offset" in result) {
          list = result.items.map(fromGlobal);
          setHasNext(Boolean(result.next_offset));
          if (result.next_offset) {
            setCursors((old) => (old.length > page ? old : [...old, result.next_offset]));
          }
        } else {
          const start = ((page - 1) % 2) * PAGE_SIZE;
          list = result.items.slice(start, start + PAGE_SIZE).map(fromNaver);
          // Two ways there is more to read: the other half of the page just fetched, or
          // a further Naver page. The second is what the old `items.length > start + 10`
          // missed — on the second half that test is always false, so the board looked
          // twenty posts deep however many pages it really had.
          setHasNext(
            result.items.length > start + PAGE_SIZE || result.items.length >= NAVER_MORE_HINT,
          );
        }
        setPosts(list);

        if (pendingOpen && list.length) {
          // Arrived here by stepping off the end of the previous page: continue reading
          // at the near end of this one instead of dropping back to the list.
          openFrom(list, pendingOpen === "first" ? 0 : list.length - 1);
        } else {
          // An ordinary page change from the list, or a page that came back empty —
          // there is nothing to keep open.
          setOpenIndex(null);
          setDetail(null);
        }
        setPendingOpen(null);
      })
      .catch(() => {
        if (cancelled) return;
        setError("종목토론을 불러오지 못했습니다.");
        setPendingOpen(null);
      })
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
    // `cursors` and `pendingOpen` are intentionally not dependencies. Both are written
    // by this effect and read for the render that triggered it: `cursors[page - 1]` is
    // the entry for the page being fetched, and `pendingOpen` was set in the same event
    // that changed `page`, so the closure already sees it. Listing them would re-run the
    // fetch every time one was updated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, source, page]);

  const atFirst = openIndex === 0 && page === 1;
  const atLast = openIndex === posts.length - 1 && !hasNext;

  /** 이전글 / 다음글, across page boundaries.
   *
   * Within the page it is a move along `posts`. At either end it turns the page and
   * hands `pendingOpen` to the fetch, which reopens the reader at the far end of the new
   * one — so the buttons walk the whole board rather than the ten posts that happen to
   * be loaded. Blocked while a fetch is in flight, so a second click cannot skip a page.
   */
  const step = (direction: -1 | 1) => {
    if (openIndex == null || loading) return;
    const next = openIndex + direction;
    if (next >= 0 && next < posts.length) {
      openFrom(posts, next);
      return;
    }
    if (direction === 1 && hasNext) {
      setPendingOpen("first");
      setPage((p) => p + 1);
    } else if (direction === -1 && page > 1) {
      setPendingOpen("last");
      setPage((p) => p - 1);
    }
  };

  const current = openIndex == null ? null : posts[openIndex];

  if (current) {
    const body = detail?.blocks ?? [];
    return (
      <div className="su-thread">
        <button type="button" className="su-thread-back" onClick={() => { setOpenIndex(null); setDetail(null); }}>
          ‹ 목록으로
        </button>
        <article className="su-thread-post">
          <h3>{detail?.title || current.title}</h3>
          <div className="su-thread-meta">
            <span className="su-thread-author">{detail?.author || current.author}</span>
            <time>{shortDateTime(detail?.written_at || current.date)}</time>
            <span className="su-thread-stat">조회 {current.views.toLocaleString()}</span>
            <span className="su-thread-stat">공감 {current.likes.toLocaleString()}</span>
          </div>
          <div className="su-thread-body">
            {detailLoading && <p className="su-inline-loading"><i />본문을 불러오는 중</p>}
            {bodyArrivesWithList && <p>{current.preview}</p>}
            {body.map((block, index) =>
              block.type === "image" && block.src ? (
                <img key={index} src={block.src} alt="" loading="lazy" />
              ) : (
                <p key={index}>{block.text}</p>
              ),
            )}
            {!detailLoading && !bodyArrivesWithList && body.length === 0 && (
              <p className="su-thread-empty">본문을 불러오지 못했습니다.</p>
            )}
          </div>
        </article>
        <nav className="su-thread-nav" aria-label="게시글 이동">
          <button type="button" disabled={atFirst || loading} onClick={() => step(-1)}>
            <small>PREV</small>
            <span>‹ 이전글</span>
          </button>
          {/* Which post of which page is open. Without it, crossing a boundary looks
              like the counter reset — the reader has no way to tell that 다음글 moved
              them onto a new page rather than back to the top of this one. */}
          <span className="su-thread-position">
            {loading ? "불러오는 중" : `${page}페이지 · ${(openIndex ?? 0) + 1}/${posts.length}`}
          </span>
          <button type="button" disabled={atLast || loading} onClick={() => step(1)}>
            <small>NEXT</small>
            <span>다음글 ›</span>
          </button>
        </nav>
      </div>
    );
  }

  return (
    <div className="su-list">
      <div className="su-list-scroll" data-track="self">
        {loading && (
          <ul className="su-post-list su-post-list--skeleton">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i}>
                <span className="su-skeleton su-skeleton--text" />
                <span className="su-skeleton su-skeleton--sub" />
              </li>
            ))}
          </ul>
        )}
        {!loading && error && <p className="su-panel-message">{error}</p>}
        {!loading && !error && posts.length === 0 && (
          <p className="su-panel-message">등록된 토론 게시글이 없습니다.</p>
        )}
        {!loading && posts.length > 0 && (
          <ul className="su-post-list">
            {posts.map((post, index) => (
              <li key={`${post.id}-${index}`}>
                <button type="button" onClick={() => open(index)}>
                  <span className="su-post-index">{String((page - 1) * PAGE_SIZE + index + 1).padStart(2, "0")}</span>
                  <span className="su-post-copy">
                    <strong>{post.title}</strong>
                    <small>
                      {post.author}
                      <i>{shortDateTime(post.date)}</i>
                    </small>
                  </span>
                  <span className="su-post-stats">
                    <em>조회 {post.views.toLocaleString()}</em>
                    <em>공감 {post.likes.toLocaleString()}</em>
                  </span>
                  <span className="su-post-caret" aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <nav className="su-list-pager" aria-label="토론 페이지">
        <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          ‹ 이전
        </button>
        <span>
          <b>{page}</b> 페이지
        </span>
        <button type="button" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
          다음 ›
        </button>
      </nav>
    </div>
  );
}
