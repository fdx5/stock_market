import { useEffect, useRef, useState } from "react";
import { DramPriceItem, FuturesItem, api } from "../api/client";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { pct } from "../mapTile";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link } from "../router";
import CommodityIcon from "./CommodityIcon";

/* 원자재 패널 — 선물가격(기본) · D램 현물가격 두 탭.
 *
 * 이 자리는 원래 D램 현물가만 보여주는 칸이었고, 반도체/전자 종목을 선택했을 때만
 * 나타났다. 그래서 대부분의 종목에서는 빈 자리였다 — 하루 한 번 갱신되는 표 하나를
 * 위해 확보해 둔 공간이 실제로는 거의 쓰이지 않았다는 뜻이다. 지금은 같은 자리가
 * 27개 상품 선물의 실시간 보드를 기본으로 들고 있고, D램은 그 옆 탭으로 물러났다.
 * 업종 조건도 사라졌다 — 선물 시세는 어떤 종목을 보고 있든 성립하는 정보다.
 *
 * 갱신은 10초 주기이되, 값이 실제로 달라졌을 때만 상태를 바꾼다. 장이 조용할 때는
 * 리렌더가 아예 일어나지 않고, 움직인 행만 잠깐 빛난다 — 어느 줄이 방금 바뀌었는지
 * 표 전체를 다시 읽지 않고 알 수 있다. */

const FUTURES_POLL_MS = 10_000;
/** 값이 바뀐 행에 색을 얹어 두는 시간. CSS의 commodity-flash 애니메이션과 맞춘다. */
const FLASH_MS = 900;

type Tab = "futures" | "dram";

/** 두 목록이 화면에 그리는 값(가격·변동)이 같은지. 같은 응답이 반복해서 도착하는
 * 조용한 장에서는 여기서 걸러 리렌더 자체를 없앤다. */
function sameFutures(a: FuturesItem[], b: FuturesItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, i) => {
    const next = b[i];
    return (
      item.symbol === next.symbol && item.price === next.price && item.change_pct === next.change_pct &&
      item.updated_at === next.updated_at
    );
  });
}

function FuturesBoard() {
  const t = useT();
  const { lang } = useLanguage();
  const en = lang === "en";
  const formatSyncedAt = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat(en ? "en-US" : "ko-KR", {
      timeZone: "Asia/Seoul",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
  };
  const [items, setItems] = useState<FuturesItem[]>([]);
  const [failed, setFailed] = useState(false);
  const itemsRef = useRef<FuturesItem[]>([]);
  /** symbol → 방향. 값이 바뀐 직후 FLASH_MS 동안만 채워져 있다. */
  const [flash, setFlash] = useState<Record<string, "up" | "down">>({});
  const timers = useRef<number[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      api
        .futures()
        .then((res) => {
          if (cancelled) return;
          if (res.items.length === 0) {
            if (itemsRef.current.length === 0) setFailed(true);
            return;
          }
          setFailed(false);
          const previous = itemsRef.current;
          if (sameFutures(previous, res.items)) return;

          const byPrice = new Map(previous.map((item) => [item.symbol, item.price]));
          const moved: Record<string, "up" | "down"> = {};
          for (const item of res.items) {
            const before = byPrice.get(item.symbol);
            if (before !== undefined && before !== item.price) {
              moved[item.symbol] = item.price > before ? "up" : "down";
            }
          }

          itemsRef.current = res.items;
          setItems(res.items);
          if (Object.keys(moved).length > 0) {
            setFlash((prev) => ({ ...prev, ...moved }));
            // 행마다 제 시간에 꺼지도록 개별 타이머를 둔다 — 하나의 타이머를 계속
            // 미루면 계속 움직이는 행 하나가 나머지 행의 하이라이트를 붙잡아 둔다.
            const timer = window.setTimeout(() => {
              if (cancelled) return;
              setFlash((prev) => {
                const next = { ...prev };
                for (const symbol of Object.keys(moved)) delete next[symbol];
                return next;
              });
            }, FLASH_MS);
            timers.current.push(timer);
          }
        })
        .catch(() => {
          // 이미 들고 있는 값은 그대로 둔다 — 한 번의 실패로 보드를 비우는 것보다
          // 10초 전 가격을 계속 보여주는 편이 낫다. 처음부터 실패한 경우에만 문구를
          // 띄운다.
          if (!cancelled && itemsRef.current.length === 0) setFailed(true);
        });
    };

    load();
    const stop = startVisibilityAwareInterval(load, FUTURES_POLL_MS);
    return () => {
      cancelled = true;
      stop();
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    };
  }, []);

  if (items.length === 0) {
    return (
      <p className="commodity-empty">
        {failed ? t("선물 시세를 불러오지 못했습니다.") : t("선물 시세를 불러오는 중...")}
      </p>
    );
  }

  return (
    <>
      {/* 7행까지 보이고 나머지는 이 안에서 스크롤한다 — 27개 계약을 모두 펼치면
          종목 상세가 화면 아래로 밀려난다. 높이는 CSS가 행 높이 × 7로 잡는다. */}
      <div className="commodity-scroll" tabIndex={0} role="group" aria-label={t("원자재")}>
        <table className="commodity-table">
          <thead>
            <tr>
              {/* "종목"이 아니라 "품목" — 사전에서 "종목"은 개수 뒤에 붙는 조수사로
                  이미 쓰이고 있어(" stocks") 열 제목으로는 영문이 깨진다. */}
              <th>{t("품목")}</th>
              <th className="commodity-market-head">{t("시장")}</th>
              <th>{t("현재가")}</th>
              <th>{t("대비")}</th>
              <th>{t("변동률")}</th>
              <th>{t("가격 연동")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const moved = flash[item.symbol];
              const tone =
                item.change_pct > 0 ? "change-up" : item.change_pct < 0 ? "change-down" : "change-flat";
              return (
                <tr key={item.symbol} className={moved ? `commodity-flash-${moved}` : ""}>
                  <td className="commodity-name">
                    <CommodityIcon icon={item.icon} />
                    <span className="commodity-name-text">{en ? item.name_en : item.name}</span>
                    <span className="commodity-unit">{item.unit}</span>
                  </td>
                  <td className="commodity-market">
                    <span className="commodity-market-info">
                      <img src={`/img/flag/${item.flag}.svg`} alt="" loading="lazy" />
                      <b>{item.flag === "gb" ? "UK" : "US"}</b>
                      <span>{item.market_name}</span>
                    </span>
                  </td>
                  <td className="commodity-price">{item.price.toFixed(item.decimals)}</td>
                  <td className={tone}>
                    {item.change > 0 ? "+" : ""}
                    {item.change.toFixed(item.decimals)}
                  </td>
                  <td className={tone}>{pct(item.change_pct)}</td>
                  <td className="commodity-synced-at">{formatSyncedAt(item.updated_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DramBoard() {
  const t = useT();
  const [priceDate, setPriceDate] = useState<string | null>(null);
  const [items, setItems] = useState<DramPriceItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // 일 배치가 하루 한 번 적재하는 스냅샷이라 폴링하지 않는다 — 탭을 열 때 한 번.
    api
      .dramPrice()
      .then((res) => {
        if (cancelled) return;
        setPriceDate(res.price_date);
        setItems(res.items);
      })
      .catch(() => {
        // 실패는 아래의 빈 상태 문구로 흡수된다.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return <p className="commodity-empty">{t("불러오는 중...")}</p>;
  if (items.length === 0) return <p className="commodity-empty">{t("표시할 D램 현물가격이 없습니다.")}</p>;

  return (
    <>
      <div className="commodity-scroll">
        <table className="commodity-table">
          <thead>
            <tr>
              <th>{t("품목")}</th>
              <th>{t("가격")} (USD)</th>
              <th>{t("일중 고가")}</th>
              <th>{t("일중 저가")}</th>
              <th>{t("변동률")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const change = item.change_pct ?? 0;
              return (
                <tr key={item.item_name}>
                  <td className="commodity-name">
                    <span className="commodity-name-text">{item.item_name}</span>
                  </td>
                  <td className="commodity-price">${item.price.toFixed(3)}</td>
                  <td>{item.daily_high != null ? `$${item.daily_high.toFixed(2)}` : "—"}</td>
                  <td>{item.daily_low != null ? `$${item.daily_low.toFixed(2)}` : "—"}</td>
                  <td className={change > 0 ? "change-up" : change < 0 ? "change-down" : "change-flat"}>
                    {pct(change)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="commodity-foot">
        {priceDate && (
          <span>
            {t("기준일")} {priceDate}
          </span>
        )}
        {/* 이 탭은 하루치를 보여준다. "그동안 어떻게 움직였나"는 바로 다음 질문이지만
            별도 페이지라, 접히는 영역이 아니라 링크로 남긴다. */}
        <Link to="/dram-price" className="commodity-history-link">
          {t("이력")}
        </Link>
      </p>
    </>
  );
}

/** 종목 상세 위에 놓이는 원자재 보드. 선택된 종목과 무관한 정보라 code/market을
 * 받지 않는다 — 어떤 종목을 보고 있든 같은 값을 보여준다. */
export default function CommodityPanel() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("futures");
  // 기본은 펼침 — 열자마자 보이라고 만든 자리지, 접힌 채로 발견하라고 만든 자리가
  // 아니다. 다만 이미 아는 값을 매번 지나칠 필요는 없으니 접을 수는 있게 둔다.
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="card commodity-panel">
      <div className="commodity-head">
        <div className="commodity-tabs" role="tablist" aria-label={t("원자재")}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "futures"}
            className={tab === "futures" ? "is-on" : ""}
            onClick={() => {
              setTab("futures");
              setExpanded(true);
            }}
          >
            {t("선물가격")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "dram"}
            className={tab === "dram" ? "is-on" : ""}
            onClick={() => {
              setTab("dram");
              setExpanded(true);
            }}
          >
            {t("D램 현물가격")}
          </button>
        </div>
        <button
          type="button"
          className="indicator-panel-toggle commodity-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? t("접기") : t("펼치기")}
          <span className={`fold-toggle-arrow ${expanded ? "up" : ""}`} aria-hidden="true">
            ▼
          </span>
        </button>
      </div>
      <div className={`commodity-body ${expanded ? "expanded" : ""}`}>
        {/* 탭을 바꾸면 언마운트된다 — 보이지 않는 D램 탭이 선물 폴러와 나란히 돌
            이유가 없고, 선물 보드는 다시 열릴 때 어차피 즉시 한 번 받아온다. */}
        {tab === "futures" ? <FuturesBoard /> : <DramBoard />}
      </div>
    </div>
  );
}
