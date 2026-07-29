import { useState } from "react";
import type { NewsItem } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import BoardPanel from "./BoardPanel";
import DailyPricePanel from "./DailyPricePanel";
import NewsPanel from "./NewsPanel";
import OrderBookPanel from "./OrderBookPanel";
import ShortSellPanel from "./ShortSellPanel";

type Tab = "board" | "news" | "daily" | "orderbook" | "shortsell";

export default function SidePanel({ code, name, news }: { code: string; name: string; news: NewsItem[] }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("board");

  return (
    <div className="card side-panel">
      <div className="market-overview-tab-bar">
        <button
          type="button"
          className={`market-overview-tab ${tab === "board" ? "active" : ""}`}
          onClick={() => setTab("board")}
        >
          {t("종목토론방")}
        </button>
        <button
          type="button"
          className={`market-overview-tab ${tab === "news" ? "active" : ""}`}
          onClick={() => setTab("news")}
        >
          {t("관련 뉴스")}
        </button>
        <button
          type="button"
          className={`market-overview-tab ${tab === "daily" ? "active" : ""}`}
          onClick={() => setTab("daily")}
        >
          {t("일별")}
        </button>
        <button
          type="button"
          className={`market-overview-tab ${tab === "orderbook" ? "active" : ""}`}
          onClick={() => setTab("orderbook")}
        >
          {t("호가")}
        </button>
        <button
          type="button"
          className={`market-overview-tab ${tab === "shortsell" ? "active" : ""}`}
          onClick={() => setTab("shortsell")}
        >
          {t("공매도")}
        </button>
      </div>

      {tab === "board" && <BoardPanel code={code} name={name} />}
      {tab === "news" && <NewsPanel items={news} name={name} />}
      {tab === "daily" && <DailyPricePanel code={code} />}
      {tab === "orderbook" && <OrderBookPanel code={code} />}
      {tab === "shortsell" && <ShortSellPanel code={code} />}
    </div>
  );
}
