import { useEffect, useState } from "react";
import {
  MarketSpec,
  displayName,
  formatChange,
  formatMarketCap,
  formatPercent,
  formatPrice,
  formatVolume,
  priceUnit,
  toneOf,
} from "../stocks/market";
import { DetailState, withLiveClose } from "../stocks/useStockData";
import { reportStocksEvent } from "../useActivityTracking";
import StockDiscussionTab from "./StockDiscussionTab";
import StockLogo from "./StockLogo";
import StockNewsTab from "./StockNewsTab";
import StockUniverseChart from "./StockUniverseChart";

/* The right panel: everything about the one stock the rail has open.
 *
 * Reads top to bottom as identity -> price -> shape -> conversation, which is the order
 * the questions actually arrive in: what is this, what is it doing, what has it been
 * doing, what is being said about it. The first three are always visible; only the last
 * changes with the tab, so switching tabs never moves the price.
 *
 * The whole panel is tinted by the day's move via a `data-tone` attribute rather than
 * per-element colour props — one attribute at the root, and the stylesheet decides how
 * far that colour is allowed to travel.
 */

type TabKey = "discussion" | "news";

interface Props {
  spec: MarketSpec;
  detail: DetailState;
}

export default function StockDetailPanel({ spec, detail }: Props) {
  const { row, quote, history, historyLoading } = detail;
  const [tab, setTab] = useState<TabKey>("discussion");

  const openTab = (next: TabKey) => {
    if (next === tab) return;
    reportStocksEvent({
      action: "tab_switch",
      market: spec.key,
      code: row.code,
      name: displayName(row),
      detail: next === "discussion" ? "종목토론" : "뉴스",
    });
    setTab(next);
  };

  // 종목토론 is the default tab per spec, and it is the default again on every stock:
  // arriving at a new company on whichever tab the last one was left on makes the tab
  // state feel like a filter over the rail, which it is not.
  useEffect(() => setTab("discussion"), [row.code]);

  // The quote is authoritative once it lands; until then the rail's own row is what
  // the panel was opened with, and showing it beats showing a dash for a second.
  const close = quote?.close ?? row.close;
  const change = quote?.change ?? row.change;
  const changePct = quote?.change_pct ?? row.change_pct;
  const tone = toneOf(changePct);
  const name = displayName(row);

  return (
    <section className="su-detail" data-tone={tone} aria-label={`${name} 상세 정보`}>
      <div className="su-detail-glow" aria-hidden="true" />

      <header className="su-detail-head">
        <div className="su-detail-identity">
          <StockLogo
            code={row.code}
            name={name}
            className={`su-detail-logo${row.logo_dark ? " su-logo-plate" : ""}`}
            assetType={spec.assetType}
          />
          <div className="su-detail-names">
            <span className="su-detail-eyebrow">
              {spec.label}
              <i>·</i>
              {row.sector || "기타"}
              <i>·</i>
              {spec.assetType === "etf" ? "거래대금" : "시총"} {row.rank}위
            </span>
            <h2>{name}</h2>
            <span className="su-detail-code">{row.code}</span>
          </div>
        </div>

        <div className="su-detail-quote">
          <strong>
            {formatPrice(close, spec.currency)}
            <small>{priceUnit(spec.currency)}</small>
          </strong>
          <div className="su-detail-move">
            <span className="su-detail-pct">{formatPercent(changePct)}</span>
            <span className="su-detail-abs">{formatChange(change, spec.currency)}</span>
          </div>
        </div>
      </header>

      <dl className="su-detail-facts">
        <div>
          <dt>{spec.assetType === "etf" ? "거래대금" : "시가총액"}</dt>
          <dd>{formatMarketCap(row.marcap, spec.currency)}</dd>
        </div>
        <div>
          <dt>거래량</dt>
          <dd>{formatVolume(row.volume)}</dd>
        </div>
        <div>
          <dt>{spec.assetType === "etf" ? "자산 유형" : "PER"}</dt>
          <dd>{spec.assetType === "etf" ? "ETF" : row.per != null && Number.isFinite(row.per) ? row.per.toFixed(2) : "—"}</dd>
        </div>
        <div>
          <dt>{spec.assetType === "etf" ? "시장" : "ROE"}</dt>
          <dd>{spec.assetType === "etf" ? spec.caption : row.roe != null && Number.isFinite(row.roe) ? `${row.roe.toFixed(2)}%` : "—"}</dd>
        </div>
      </dl>

      <StockUniverseChart
        points={withLiveClose(history, close)}
        tone={tone}
        currency={spec.currency}
        loading={historyLoading}
      />

      <div className="su-detail-tabs" role="tablist" aria-label="상세 정보 탭" data-track="self">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "discussion"}
          className={tab === "discussion" ? "is-active" : ""}
          onClick={() => openTab("discussion")}
        >
          종목토론
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "news"}
          className={tab === "news" ? "is-active" : ""}
          onClick={() => openTab("news")}
        >
          뉴스
        </button>
      </div>

      <div className="su-detail-tabbody">
        {/* Keyed by code so switching stocks remounts the tab rather than letting the
            previous company's posts sit under the new company's header while the next
            request is in flight. */}
        {tab === "discussion" ? (
          <StockDiscussionTab
            key={`d-${row.code}`}
            code={row.code}
            name={name}
            market={spec.key}
            source={spec.discussion}
          />
        ) : (
          <StockNewsTab key={`n-${row.code}`} code={row.code} name={name} market={spec.key} source={spec.news} />
        )}
      </div>
    </section>
  );
}
