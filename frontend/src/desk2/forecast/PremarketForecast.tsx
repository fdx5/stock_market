import { useEffect, useId, useRef, useState } from "react";
import { api, type PredictionItem, type PremarketGroup, type PremarketMarket, type PremarketScope } from "../../api/client";
import StockLogo from "../../components/StockLogo";
import NeoIcon from "../../neo/NeoIcon";
import { startVisibilityAwareInterval } from "../../pollVisibility";
import { formatChangeRate, formatFullDate, formatMoney, probabilities, RESULT_ARROW, RESULT_CLASS } from "../../prediction";
import { Link } from "../../router";
import { useL } from "../lib";
import "./premarket.css";

const MARKET_LABELS = { KOSPI: "코스피", KOSDAQ: "코스닥", NASDAQ: "나스닥" };
const MARKETS: Record<PremarketScope, PremarketMarket[]> = {
  all: ["KOSPI", "KOSDAQ", "NASDAQ"],
  kr: ["KOSPI", "KOSDAQ"],
  us: ["NASDAQ"],
};

async function loadReader() {
  const [reader] = await Promise.all([
    import("./shared"),
    import("../pages.css"),
    import("./forecast.css"),
  ]);
  return reader.ForecastReader;
}

type Preview = PremarketGroup["items"][number];
type Detail = {
  market: PremarketMarket;
  date: string;
  code: string;
  reader?: { Component: Awaited<ReturnType<typeof loadReader>>; item: PredictionItem };
  failed?: boolean;
};

function ForecastCard({ item, market, busy, onOpen }: {
  item: Preview;
  market: PremarketMarket;
  busy: boolean;
  onOpen: () => void;
}) {
  const L = useL();
  const change = formatChangeRate(item.change_rate);
  const p = probabilities(item);

  return (
    <button
      type="button"
      className="ng-premarket-card"
      aria-label={L(`${item.name} ${change} 예측 상세`, `${item.name} ${change} forecast details`)}
      aria-haspopup="dialog"
      aria-busy={busy}
      onClick={onOpen}
    >
      <span className="ng-premarket-identity">
        <StockLogo code={item.code} name={item.name} className="ng-premarket-logo" />
        <span className="ng-premarket-name"><strong>{item.name}</strong><small>{item.code}</small></span>
        <span className="ng-premarket-details" aria-hidden="true">
          <span>{busy ? L("불러오는 중", "Loading") : L("상세 보기", "View details")}</span>
          <NeoIcon name="chevron" />
        </span>
      </span>
      <span className="ng-premarket-price">
        <b>{formatMoney(item.predict_price, market)}</b>
        <em className={`is-${RESULT_CLASS[item.result]}`}>{RESULT_ARROW[item.result]} {change}</em>
      </span>
      <span className="ng-premarket-basis">
        <span>{L("기준가", "Base")} {formatMoney(item.base_price, market)}</span>
        {item.reliability !== null && <span>{L("신뢰도", "Reliability")} {item.reliability}</span>}
      </span>
      {p && (
        <span className="ng-premarket-prob" role="img"
          aria-label={L(`상승 ${p.up}%, 보합 ${p.flat}%, 하락 ${p.down}%`, `Up ${p.up}%, flat ${p.flat}%, down ${p.down}%`)}>
          <i className="is-up" style={{ width: `${p.up}%` }} />
          <i className="is-flat" style={{ width: `${p.flat}%` }} />
          <i className="is-down" style={{ width: `${p.down}%` }} />
        </span>
      )}
    </button>
  );
}

export default function PremarketForecast({ scope }: { scope: PremarketScope }) {
  const L = useL();
  const headingId = useId();
  const [groups, setGroups] = useState<PremarketGroup[]>([]);
  const [now, setNow] = useState(Date.now);
  const [selected, setSelected] = useState<PremarketMarket>(MARKETS[scope][0]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const available = groups.filter((group) => group.hide_at > now);
  const active = available.find((group) => group.market === selected) ?? available[0];
  const activeDetail = detail?.market === active?.market && detail?.date === active?.date ? detail : null;
  const nextCutoff = Math.min(...available.map((group) => group.hide_at));

  useEffect(() => {
    let request: AbortController | null = null;
    const refresh = () => {
      if (request) return;
      const controller = new AbortController();
      request = controller;
      api.premarketForecasts(scope, controller.signal).then(({ groups }) => {
        if (controller.signal.aborted) return;
        setNow(Date.now());
        setGroups(groups);
      }).catch(() => {
        // Keep forecasts for their published window during temporary network errors.
      }).finally(() => {
        request = null;
      });
    };
    refresh();
    const stop = startVisibilityAwareInterval(refresh, 120_000);
    return () => {
      stop();
      request?.abort();
      detailRequest.current?.abort();
    };
  }, [scope]);

  useEffect(() => {
    const updateClock = () => setNow(Date.now());
    const timer = Number.isFinite(nextCutoff)
      ? window.setTimeout(updateClock, Math.max(0, nextCutoff - Date.now()))
      : undefined;
    document.addEventListener("visibilitychange", updateClock);
    window.addEventListener("pageshow", updateClock);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", updateClock);
      window.removeEventListener("pageshow", updateClock);
    };
  }, [nextCutoff, now]);

  const closeDetail = () => {
    detailRequest.current?.abort();
    setDetail(null);
  };

  const openDetail = (group: PremarketGroup, code: string) => {
    if (Date.now() >= group.hide_at) {
      setNow(Date.now());
      return;
    }
    detailRequest.current?.abort();
    const request = new AbortController();
    detailRequest.current = request;
    const target = { market: group.market, date: group.date, code };
    setDetail(target);
    Promise.all([api.predictionSession(code, group.market, group.date, request.signal), loadReader()])
      .then(([item, Component]) => {
        if (!request.signal.aborted && Date.now() < group.hide_at) {
          setDetail({ ...target, reader: { Component, item } });
        }
      })
      .catch(() => {
        if (!request.signal.aborted) setDetail({ ...target, failed: true });
      });
  };

  if (!active) return null;
  const markets = MARKETS[scope];
  const reader = activeDetail?.reader;
  const marketLabel = (market: PremarketMarket) => L(MARKET_LABELS[market], market);

  return (
    <section className="ng-panel ng-premarket" aria-labelledby={headingId}>
      <header className="ng-premarket-head">
        <div className="ng-premarket-title">
          <h2 id={headingId}><NeoIcon name="spark" />{L("AI 주가 예측", "AI stock forecasts")}</h2>
          <small>{L("예측은 빗나갈 수 있으니 참고용으로만 활용하세요.", "Forecasts may be inaccurate. Use them for reference only.")}</small>
        </div>
        <div className="ng-premarket-meta">
          <p>{formatFullDate(active.date)} · {L("장전 · 시가총액 순", "Premarket · by market cap")}</p>
          <Link to={`/ai-prediction?date=${active.date}&market=${active.market}`}>
            {L("전체 예측", "All forecasts")} <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>
      {markets.length > 1 ? (
        <div className="ng-premarket-markets" role="group" aria-label={L("예측 시장 선택", "Forecast market")}>
          {markets.map((market) => (
            <button key={market} type="button" aria-pressed={active.market === market}
              disabled={!available.some((group) => group.market === market)}
              onClick={() => { closeDetail(); setSelected(market); }}>
              {marketLabel(market)}
            </button>
          ))}
        </div>
      ) : <p className="ng-premarket-single">{marketLabel(active.market)}</p>}
      <div className="ng-premarket-grid" aria-label={marketLabel(active.market)}>
        {active.items.map((item) => (
          <ForecastCard key={item.code} item={item} market={active.market} onOpen={() => openDetail(active, item.code)}
            busy={activeDetail?.code === item.code && !reader && !activeDetail.failed} />
        ))}
      </div>
      {activeDetail?.failed && <p className="ng-premarket-status" role="status">
        {L("예측 상세를 불러오지 못했습니다. 카드를 눌러 다시 시도해 주세요.", "Forecast details could not load. Select a card to retry.")}
      </p>}
      {reader && <reader.Component item={reader.item} onClose={closeDetail} />}
    </section>
  );
}
