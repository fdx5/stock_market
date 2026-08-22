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

export default function MarketBubbleStockLink({ code, market }: { code: string; market: BubbleMarket }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let alive = true;
    setVisible(false);
    loadBoard(market).then((board) => {
      if (!alive) return;
      const topCodes = board.items.slice().sort((a, b) => a.rank - b.rank).slice(0, 20);
      setVisible(topCodes.some((item) => item.code.toUpperCase() === code.toUpperCase()));
    }).catch(() => { if (alive) setVisible(false); });
    return () => { alive = false; };
  }, [code, market]);

  if (!visible) return null;
  const marketLabel = market === "kosdaq" ? "코스닥" : market === "nasdaq" ? "나스닥" : "코스피";
  return (
    <div className="stock-bubble-detail-row">
      <Link
        to={`/market-bubbles?market=${market}`}
        className="stock-bubble-detail-link"
        aria-label={`${marketLabel} 증시버블로 이동`}
        title={`${marketLabel} 증시버블에서 보기`}
      >
        <MarketBubbleIcon /> 증시버블 보기
      </Link>
    </div>
  );
}
