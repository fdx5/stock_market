import { useEffect, useState } from "react";
import { BoardPost, api } from "../api/client";

export default function DiscussionHeadlineTicker({ code }: { code: string }) {
  const [posts, setPosts] = useState<BoardPost[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.board(code, 1, true)
      .then((result) => {
        if (!cancelled) setPosts(result.items.slice(0, 10));
      })
      .catch(() => {
        if (!cancelled) setPosts([]);
      });
    return () => { cancelled = true; };
  }, [code]);

  if (posts.length === 0) return null;

  const renderSet = (copy: number) => posts.map((post, index) => (
    <span className="discussion-headline-item" key={`${copy}-${post.nid}`}>
      <i>{String(index + 1).padStart(2, "0")}</i>
      {post.title}
    </span>
  ));

  return (
    <div className="discussion-headline-ticker" aria-label="최근 종목토론 제목 10건">
      <span className="discussion-headline-label"><i /> LIVE TALK</span>
      <div className="discussion-headline-window">
        <div className="discussion-headline-track">
          <span className="discussion-headline-set">{renderSet(0)}</span>
          <span className="discussion-headline-set" aria-hidden="true">{renderSet(1)}</span>
        </div>
      </div>
    </div>
  );
}
