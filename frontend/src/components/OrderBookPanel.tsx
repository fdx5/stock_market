import { useEffect, useState } from "react";
import { OrderBook, api } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";

// Matches the backend's own cache TTL (app/routers/stock.py TTL_ORDERBOOK_SECONDS) -
// the upstream Naver page is itself 20-minutes delayed, so polling faster than that
// TTL would just re-fetch the same cached ladder.
const ORDERBOOK_POLL_MS = 15_000;

export default function OrderBookPanel({ code }: { code: string }) {
  const t = useT();
  const [book, setBook] = useState<OrderBook | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBook(null);
    setError(null);

    const load = () => {
      api
        .orderbook(code)
        .then((res) => {
          if (!cancelled) setBook(res);
        })
        .catch((err: Error) => {
          if (!cancelled) setError(err.message || "호가 데이터를 가져오지 못했습니다.");
        });
    };

    load();
    const stopPolling = startVisibilityAwareInterval(load, ORDERBOOK_POLL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [code]);

  if (error) return <div className="orderbook-status error-state">{t(error)}</div>;
  if (!book) return <div className="orderbook-status">{t("불러오는 중...")}</div>;

  const maxQty = Math.max(1, ...book.asks.map((l) => l.qty), ...book.bids.map((l) => l.qty));

  return (
    <div className="orderbook-panel">
      <div className="orderbook-note">{t("20분 지연")}</div>
      <div className="orderbook-header">
        <span>{t("매도잔량")}</span>
        <span>{t("호가")}</span>
        <span>{t("매수잔량")}</span>
      </div>
      <div className="orderbook-ladder">
        {book.asks.map((level) => (
          <div className="orderbook-row" key={`ask-${level.price}`}>
            <div className="orderbook-qty ask">
              <div className="orderbook-bar ask" style={{ width: `${(level.qty / maxQty) * 100}%` }} />
              <span>{level.qty.toLocaleString()}</span>
            </div>
            <div className="orderbook-price ask">{level.price.toLocaleString()}</div>
            <div className="orderbook-qty" />
          </div>
        ))}
        {book.bids.map((level) => (
          <div className="orderbook-row" key={`bid-${level.price}`}>
            <div className="orderbook-qty" />
            <div className="orderbook-price bid">{level.price.toLocaleString()}</div>
            <div className="orderbook-qty bid">
              <div className="orderbook-bar bid" style={{ width: `${(level.qty / maxQty) * 100}%` }} />
              <span>{level.qty.toLocaleString()}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="orderbook-footer">
        <span className="ask">{book.total_ask_qty.toLocaleString()}</span>
        <span>{t("잔량합계")}</span>
        <span className="bid">{book.total_bid_qty.toLocaleString()}</span>
      </div>
    </div>
  );
}
