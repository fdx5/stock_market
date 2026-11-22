import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { api, type PredictionItem, type PremarketGroup, type PremarketMarket, type PremarketScope } from "../../api/client";
import StockLogo from "../../components/StockLogo";
import NeoIcon from "../../neo/NeoIcon";
import { startVisibilityAwareInterval } from "../../pollVisibility";
import { formatChangeRate, formatFullDate, formatMoney, probabilities, RESULT_ARROW, RESULT_CLASS } from "../../prediction";
import { Link } from "../../router";
import { useL } from "../lib";
import PremarketShareActions from "./PremarketShareActions";
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

function ForecastCard({ item, market, busy, onOpen, selection }: {
  item: Preview;
  market: PremarketMarket;
  busy: boolean;
  onOpen: () => void;
  selection?: { checked: boolean; onChange: () => void };
}) {
  const L = useL();
  const change = formatChangeRate(item.change_rate);
  const p = probabilities(item);

  const direction = RESULT_CLASS[item.result];
  const content = (
    <>
      <span className="ng-premarket-identity">
        <StockLogo code={item.code} name={item.name} className="ng-premarket-logo" />
        <span className="ng-premarket-name"><strong>{item.name}</strong><small>{item.code}</small></span>
        {selection && <input type="checkbox" checked={selection.checked} onChange={selection.onChange}
          aria-label={L(`${item.name} 선택`, `Select ${item.name}`)} />}
      </span>
      <span className="ng-premarket-price">
        <b>{formatMoney(item.predict_price, market)}</b>
        <em className={`is-${direction}`}>{RESULT_ARROW[item.result]} {change}</em>
      </span>
      <span className="ng-premarket-basis">
        <span>{L("기준가", "Base")} {formatMoney(item.base_price, market)}</span>
      </span>
      {p && (
        <span className="ng-premarket-prob" role="img"
          aria-label={L(`상승 ${p.up}%, 보합 ${p.flat}%, 하락 ${p.down}%`, `Up ${p.up}%, flat ${p.flat}%, down ${p.down}%`)}>
          <i className="is-up" style={{ width: `${p.up}%` }} />
          <i className="is-flat" style={{ width: `${p.flat}%` }} />
          <i className="is-down" style={{ width: `${p.down}%` }} />
        </span>
      )}
      {p && (
        <span className="ng-premarket-prob-values" aria-hidden="true">
          <span className="is-up">{L("상승", "Up")} {p.up}%</span>
          <span className="is-flat">{L("보합", "Flat")} {p.flat}%</span>
          <span className="is-down">{L("하락", "Down")} {p.down}%</span>
        </span>
      )}
      <span className="ng-premarket-card-foot">
        {item.reliability !== null && <span>{L("신뢰도", "Reliability")} {item.reliability}</span>}
        {!selection && <span className="ng-premarket-details" aria-hidden="true">
          <span>{busy ? L("불러오는 중", "Loading") : L("상세 보기", "View details")}</span>
          <NeoIcon name="chevron" />
        </span>}
      </span>
    </>
  );

  if (selection) {
    return <label className={`ng-premarket-card ng-premarket-selectable${selection.checked ? " is-checked" : ""}`}
      data-direction={direction}>{content}</label>;
  }
  return (
    <button type="button" className="ng-premarket-card" data-direction={direction}
      aria-label={L(`${item.name} ${change} 예측 상세`, `${item.name} ${change} forecast details`)}
      aria-haspopup="dialog" aria-busy={busy} onClick={onOpen}>
      {content}
    </button>
  );
}

export default function PremarketForecast({ scope }: { scope: PremarketScope }) {
  const L = useL();
  const headingId = useId();
  const [groups, setGroups] = useState<PremarketGroup[]>([]);
  const [now, setNow] = useState(0);
  const clock = useRef({ serverTime: 0, measuredAt: 0 });
  const currentTime = useCallback(() => clock.current.serverTime + (performance.now() - clock.current.measuredAt), []);
  const [selected, setSelected] = useState<PremarketMarket>(MARKETS[scope][0]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [shareKey, setShareKey] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const shareButton = useRef<HTMLButtonElement>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const available = groups.filter((group) => group.hide_at > now);
  const active = available.find((group) => group.market === selected) ?? available[0];
  const sessionKey = active ? `${active.market}:${active.date}` : null;
  const selecting = shareKey !== null && shareKey === sessionKey;
  const selectedItems = useMemo(() => selecting && active ? active.items.filter((item) => codes.includes(item.code)) : [],
    [active, codes, selecting]);
  const activeDetail = detail?.market === active?.market && detail?.date === active?.date ? detail : null;
  const nextCutoff = Math.min(...available.map((group) => group.hide_at));

  useEffect(() => {
    let request: AbortController | null = null;
    const refresh = () => {
      if (request) return;
      const controller = new AbortController();
      request = controller;
      api.premarketForecasts(scope, controller.signal).then(({ server_now, groups }) => {
        if (controller.signal.aborted) return;
        clock.current = { serverTime: server_now, measuredAt: performance.now() };
        setNow(server_now);
        setGroups(groups);
      }).catch(() => {
        // Keep forecasts for their published window during temporary network errors.
      }).finally(() => {
        request = null;
      });
    };
    refresh();
    const stop = startVisibilityAwareInterval(refresh, 120_000);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.removeEventListener("pageshow", refresh);
      stop();
      request?.abort();
      detailRequest.current?.abort();
    };
  }, [scope]);

  useEffect(() => {
    const updateClock = () => setNow(currentTime());
    const timer = Number.isFinite(nextCutoff)
      ? window.setTimeout(updateClock, Math.max(0, Math.ceil(nextCutoff - currentTime())))
      : undefined;
    document.addEventListener("visibilitychange", updateClock);
    window.addEventListener("pageshow", updateClock);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", updateClock);
      window.removeEventListener("pageshow", updateClock);
    };
  }, [currentTime, nextCutoff, now]);

  const closeDetail = () => {
    detailRequest.current?.abort();
    setDetail(null);
  };

  const openDetail = (group: PremarketGroup, code: string) => {
    const openedAt = currentTime();
    if (openedAt >= group.hide_at) {
      setNow(openedAt);
      return;
    }
    detailRequest.current?.abort();
    const request = new AbortController();
    detailRequest.current = request;
    const target = { market: group.market, date: group.date, code };
    setDetail(target);
    Promise.all([api.predictionSession(code, group.market, group.date, request.signal), loadReader()])
      .then(([item, Component]) => {
        if (!request.signal.aborted && currentTime() < group.hide_at) {
          setDetail({ ...target, reader: { Component, item } });
        }
      })
      .catch(() => {
        if (!request.signal.aborted) setDetail({ ...target, failed: true });
      });
  };

  if (!active) return null;
  const closeShare = () => {
    setShareKey(null);
    setCodes([]);
  };
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
          <button type="button" className="ng-premarket-share-toggle" ref={shareButton} aria-pressed={selecting}
            onClick={() => {
              closeDetail();
              if (selecting) closeShare();
              else { setCodes([]); setShareKey(sessionKey); }
            }}>
            <NeoIcon name="layers" />{L("이미지 공유하기", "Share image")}
          </button>
        </div>
      </header>
      {markets.length > 1 ? (
        <div className="ng-premarket-markets" role="group" aria-label={L("예측 시장 선택", "Forecast market")}>
          {markets.map((market) => (
            <button key={market} type="button" aria-pressed={active.market === market}
              disabled={!available.some((group) => group.market === market)}
              onClick={() => { if (active.market !== market) { closeShare(); closeDetail(); setSelected(market); } }}>
              {marketLabel(market)}
            </button>
          ))}
        </div>
      ) : <p className="ng-premarket-single">{marketLabel(active.market)}</p>}
      {selecting && <p className="ng-premarket-share-instructions" role="status">
        {L("공유할 종목을 선택하세요.", "Select the stocks you want to share.")}
      </p>}
      <div className="ng-premarket-grid" aria-label={marketLabel(active.market)}>
        {active.items.map((item) => (
          <ForecastCard key={item.code} item={item} market={active.market} onOpen={() => openDetail(active, item.code)}
            busy={activeDetail?.code === item.code && !reader && !activeDetail.failed}
            selection={selecting ? {
              checked: codes.includes(item.code),
              onChange: () => setCodes((old) => old.includes(item.code)
                ? old.filter((code) => code !== item.code)
                : [...old, item.code]),
            } : undefined} />
        ))}
      </div>
      {selecting && <PremarketShareActions
        key={`${sessionKey}:${selectedItems.map((item) => item.code).join(",")}`}
        group={active} items={selectedItems} marketLabel={marketLabel(active.market)}
        onCancel={() => { closeShare(); shareButton.current?.focus(); }} />}
      {activeDetail?.failed && <p className="ng-premarket-status" role="status">
        {L("예측 상세를 불러오지 못했습니다. 카드를 눌러 다시 시도해 주세요.", "Forecast details could not load. Select a card to retry.")}
      </p>}
      {reader && <reader.Component item={reader.item} onClose={closeDetail} />}
    </section>
  );
}
