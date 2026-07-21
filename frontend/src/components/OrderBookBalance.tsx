import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";

// Same cadence as OrderBookPanel — both read the one backend-cached ladder
// (TTL_ORDERBOOK_SECONDS), so the second consumer costs a cache hit, not a scrape.
const POLL_MS = 15_000;

/** Total bid vs. ask depth as a single proportional bar. The full ladder lives a
 * tab away in the side panel; this surfaces the one number most visitors actually
 * want from it — which side is stacked deeper right now — without a click. */
export default function OrderBookBalance({ code }: { code: string }) {
  const t = useT();
  const [totals, setTotals] = useState<{ ask: number; bid: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTotals(null);

    const load = () => {
      api
        .orderbook(code)
        .then((res) => {
          if (!cancelled) setTotals({ ask: res.total_ask_qty, bid: res.total_bid_qty });
        })
        .catch(() => {
          // The bar simply stays hidden (or keeps its last values) — it's a
          // secondary readout, not something worth an error row in the header.
        });
    };

    load();
    const stopPolling = startVisibilityAwareInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [code]);

  if (!totals) return null;
  const total = totals.ask + totals.bid;
  if (total <= 0) return null;

  const bidPct = (totals.bid / total) * 100;
  const askPct = 100 - bidPct;
  // "매수 우위" is the plain-language read of a deeper bid side; the percentages
  // stay visible either way so the label never has to carry the whole meaning.
  const leaning = bidPct >= 50 ? t("매수 우위") : t("매도 우위");

  return (
    <div className="orderbook-balance">
      <div className="orderbook-balance-top">
        <span className="orderbook-balance-title">{t("호가 잔량")}</span>
        <span className={`orderbook-balance-lean ${bidPct >= 50 ? "change-up" : "change-down"}`}>{leaning}</span>
      </div>
      <div
        className="orderbook-balance-bar"
        role="img"
        aria-label={`${t("매수잔량")} ${bidPct.toFixed(0)}%, ${t("매도잔량")} ${askPct.toFixed(0)}%`}
      >
        <span className="orderbook-balance-fill is-bid" style={{ width: `${bidPct}%` }} />
        <span className="orderbook-balance-fill is-ask" style={{ width: `${askPct}%` }} />
      </div>
      <div className="orderbook-balance-legend">
        <span className="change-up">
          {t("매수")} {bidPct.toFixed(0)}% · {totals.bid.toLocaleString()}
        </span>
        <span className="change-down">
          {totals.ask.toLocaleString()} · {askPct.toFixed(0)}% {t("매도")}
        </span>
      </div>
    </div>
  );
}
