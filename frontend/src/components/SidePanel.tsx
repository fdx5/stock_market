import { useState } from "react";
import type { NewsItem } from "../api/client";
import BoardPanel from "./BoardPanel";
import NewsPanel from "./NewsPanel";

type Tab = "board" | "news";

export default function SidePanel({ code, name, news }: { code: string; name: string; news: NewsItem[] }) {
  const [tab, setTab] = useState<Tab>("board");

  return (
    <div className="card side-panel">
      <div className="market-overview-tab-bar">
        <button
          type="button"
          className={`market-overview-tab ${tab === "board" ? "active" : ""}`}
          onClick={() => setTab("board")}
        >
          종목토론방
        </button>
        <button
          type="button"
          className={`market-overview-tab ${tab === "news" ? "active" : ""}`}
          onClick={() => setTab("news")}
        >
          관련 뉴스
        </button>
      </div>

      {tab === "board" && <BoardPanel code={code} name={name} />}
      {tab === "news" && <NewsPanel items={news} name={name} />}
    </div>
  );
}
