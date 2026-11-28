import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AssetKind, DiscussionPost, MarketKind } from "../../components/discussion/types";
import { fetchStockDiscussionBatch } from "../../components/discussion/stockDiscussionFeed";
import { useL } from "../lib";

const LIMIT = 30;
const SPEED = 64;

export default function StockDiscussionTicker({ code, market, kind, onSelect }: {
  code: string;
  market: MarketKind;
  kind: AssetKind;
  onSelect: (post: DiscussionPost) => void;
}) {
  const L = useL();
  const [posts, setPosts] = useState<DiscussionPost[]>([]);
  const [paused, setPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const sequence = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchStockDiscussionBatch(code, market, kind, { limit: LIMIT, signal: controller.signal })
      .then(({ items }) => { if (!controller.signal.aborted) setPosts(items.slice(0, LIMIT)); })
      .catch(() => {});
    return () => controller.abort();
  }, [code, kind, market]);

  useLayoutEffect(() => {
    const list = sequence.current;
    const viewportNode = viewport.current;
    if (!list || !viewportNode) return;
    const measure = () => setDuration(list.offsetWidth > viewportNode.clientWidth ? list.offsetWidth / SPEED : 0);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    observer.observe(viewportNode);
    return () => observer.disconnect();
  }, [posts]);

  if (posts.length === 0) return null;
  const pass = (copy: boolean) => (
    <div className="sk-discussion-ticker-sequence" ref={copy ? undefined : sequence} aria-hidden={copy || undefined}>
      {posts.map((post, index) => (
        <button key={post.id} type="button" className="sk-discussion-ticker-item" title={post.title}
          tabIndex={copy ? -1 : undefined} onClick={() => onSelect(post)}>
          <b aria-hidden="true">{String(index + 1).padStart(2, "0")}</b>
          <span>{post.title}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="sk-discussion-ticker" role="region" aria-label={L("최근 종목토론", "Latest stock discussions")}
      data-paused={paused || undefined}>
      <span className="sk-discussion-ticker-label">{L("최근 토론", "Recent posts")}</span>
      <div className="sk-discussion-ticker-window" ref={viewport}>
        <div className="sk-discussion-ticker-track" style={duration ? { animationDuration: `${duration}s` } : undefined}
          data-scroll={duration > 0 || undefined}>
          {pass(false)}
          {duration > 0 && pass(true)}
        </div>
      </div>
      {duration > 0 && <button type="button" className="sk-discussion-ticker-toggle"
        aria-label={paused ? L("티커 재생", "Play ticker") : L("티커 일시정지", "Pause ticker")}
        onClick={() => {
          if (paused && viewport.current) viewport.current.scrollLeft = 0;
          setPaused(!paused);
        }}><span aria-hidden="true">{paused ? "▶" : "Ⅱ"}</span></button>}
    </div>
  );
}
