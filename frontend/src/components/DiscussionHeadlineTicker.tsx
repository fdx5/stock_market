import { useEffect, useState } from "react";
import { api } from "../api/client";

type HeadlinePost = { id: string; title: string };

export default function DiscussionHeadlineTicker({ code, market = "KR" }: { code: string; market?: "KR" | "US" }) {
  const [posts, setPosts] = useState<HeadlinePost[]>([]);

  useEffect(() => {
    let cancelled = false;
    const request = market === "US"
      ? api.globalDiscussion(code, 10).then((result) => result.items.slice(0, 10).map((post) => ({ id: post.id, title: post.title || post.text })))
      : api.board(code, 1, true).then((result) => result.items.slice(0, 10).map((post) => ({ id: post.nid, title: post.title })));
    request
      .then((items) => {
        if (!cancelled) setPosts(items);
      })
      .catch(() => {
        if (!cancelled) setPosts([]);
      });
    return () => { cancelled = true; };
  }, [code, market]);

  if (posts.length === 0) return null;

  const renderSet = (copy: number) => posts.map((post, index) => (
    <span className="discussion-headline-item" key={`${copy}-${post.id}`}>
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
