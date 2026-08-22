import { useEffect, useState } from "react";
import { StockBoard, api } from "../api/client";
import { Link } from "../router";
import MarketBubbleIcon from "./MarketBubbleIcon";

type BubbleMarket = "kospi" | "kosdaq" | "nasdaq";

const boardCache = new Map<BubbleMarket, Promise<StockBoard>>();

function loadBoard(market: BubbleMarket) {
  const cached = boardCache.get(market);
  if (cached) return cached;
  const request = api.stockBoard(market).catch((error) => {
    boardCache.delete(market);
    throw error;
  });
  boardCache.set(market, request);
  return request;
}

export default function MarketBubbleStockLink({ code, market }: { code: string; market: BubbleMarket | "kr" }) {
  const [targetMarket, setTargetMarket] = useState<BubbleMarket | null>(null);

  useEffect(() => {
    let alive = true;
    setTargetMarket(null);
    const markets: BubbleMarket[] = market === "kr" ? ["kospi", "kosdaq"] : [market];
    Promise.all(markets.map(async (candidate) => ({ candidate, board: await loadBoard(candidate) }))).then((results) => {
      if (!alive) return;
      const matched = results.find(({ board }) => board.items.slice().sort((a, b) => a.rank - b.rank).slice(0, 20)
        .some((item) => item.code.toUpperCase() === code.toUpperCase()));
      setTargetMarket(matched?.candidate ?? null);
    }).catch(() => { if (alive) setTargetMarket(null); });
    return () => { alive = false; };
  }, [code, market]);

  if (!targetMarket) return null;
  const marketLabel = targetMarket === "kosdaq" ? "코스닥" : targetMarket === "nasdaq" ? "나스닥" : "코스피";
  return (
    <div className="stock-bubble-detail-row">
      <Link
        to={`/market-bubbles?market=${targetMarket}`}
        className="stock-bubble-detail-link"
        aria-label={`${marketLabel} 증시버블로 이동`}
        title={`${marketLabel} 증시버블에서 보기`}
      >
        <MarketBubbleIcon /> 증시버블 보기
      </Link>
    </div>
  );
}
