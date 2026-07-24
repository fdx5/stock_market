import { useEffect, useRef, useState } from "react";
import { PredictionItem } from "../api/client";
import {
  RELIABILITY_CLASS,
  RESULT_ARROW,
  RESULT_CLASS,
  accuracyTone,
  formatAccuracy,
  formatChangeRate,
  formatMoney,
  formatPrice,
  isKrxCode,
  moneyAffix,
  usLogoUrl,
} from "../prediction";
import PredictionProbabilityBar from "./PredictionProbabilityBar";
import SlotMachineValue from "./SlotMachineValue";
import StockIcon from "./StockIcon";

function Logo({ code, name }: { code: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (isKrxCode(code)) return <StockIcon code={code} className="pred-card-logo-img" />;

  const url = usLogoUrl(code);
  if (!url || failed) {
    // A monogram rather than a broken-image icon: the US roster follows index weights,
    // so a ticker with no bundled logo is an ordinary outcome, not a missing asset.
    return <span className="pred-card-logo-mono">{name.slice(0, 2)}</span>;
  }
  return <img src={url} alt="" className="pred-card-logo-img" onError={() => setFailed(true)} />;
}

/** Fires once when the card first scrolls into view, so the entrance animation and the
 * price reveal play as the reader reaches each card instead of all at once above the
 * fold (where most of them would be missed entirely). Falls back to "visible
 * immediately" wherever IntersectionObserver isn't available. */
function useRevealOnScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [revealed, setRevealed] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (revealed) return;
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [revealed]);

  return { ref, revealed };
}

/** The verdict of a graded call. Present only on a past session — today's forecast has
 * no outcome yet, and an empty placeholder here would imply one is missing. */
function Outcome({ item }: { item: PredictionItem }) {
  if (item.hit === null) return null;
  const tone = item.actual_result ? RESULT_CLASS[item.actual_result] : "flat";
  return (
    <span className={`pred-outcome pred-outcome--${item.hit ? "hit" : "miss"}`}>
      <span className="pred-outcome-mark" aria-hidden="true">
        {item.hit ? "✓" : "✕"}
      </span>
      <span className="pred-outcome-text">
        {item.hit ? "적중" : "빗나감"}
        {item.actual_result ? (
          <>
            {" · 실제 "}
            <b className={`pred-outcome-actual pred-outcome-actual--${tone}`}>
              {item.actual_result}
              {item.actual_change_rate !== null ? ` ${formatChangeRate(item.actual_change_rate)}` : ""}
            </b>
          </>
        ) : (
          " · 실제 시세 확인 불가"
        )}
      </span>
    </span>
  );
}

export default function PredictionCard({
  item,
  index,
  onOpen,
}: {
  item: PredictionItem;
  index: number;
  onOpen: (item: PredictionItem) => void;
}) {
  const { ref, revealed } = useRevealOnScroll<HTMLButtonElement>();
  const tone = RESULT_CLASS[item.result];
  const priceText = formatPrice(item.predict_price, item.market);
  const affix = moneyAffix(item.market);
  const recent = item.accuracy?.recent20;

  return (
    <button
      ref={ref}
      type="button"
      className={`pred-card pred-card--${tone}${revealed ? " is-revealed" : ""}${
        item.confidence === "강" ? " pred-card--strong" : ""
      }${item.reliability_grade === "낮음" ? " pred-card--unreliable" : ""}${
        item.hit === null ? "" : ` pred-card--${item.hit ? "hit" : "miss"}`
      }`}
      // Staggers the entrance across a row without needing a per-card timer. Capped so
      // a long market group's last cards don't sit blank for a noticeable beat.
      style={{ animationDelay: `${Math.min(index, 9) * 60}ms` }}
      onClick={() => onOpen(item)}
      aria-label={`${item.name} 익일 ${item.result} 예측, ${formatChangeRate(item.change_rate)}, 신뢰도 ${
        item.reliability_grade ?? "미측정"
      }. 상세 보기`}
    >
      <span className="pred-card-glow" aria-hidden="true" />

      <span className="pred-card-head">
        <span className="pred-card-logo">
          <Logo code={item.code} name={item.name} />
        </span>
        <span className="pred-card-id">
          <span className="pred-card-name">{item.name}</span>
          <span className="pred-card-code">{item.code}</span>
        </span>
        <span className={`pred-verdict pred-verdict--${tone}`}>
          <span className="pred-verdict-arrow" aria-hidden="true">
            {RESULT_ARROW[item.result]}
          </span>
          {item.result}
        </span>
      </span>

      <span className="pred-card-price">
        <span className="pred-card-price-main">
          {affix.prefix ? <span className="pred-price-unit pred-price-unit--pre">{affix.prefix}</span> : null}
          {revealed ? (
            <SlotMachineValue value={item.predict_price} text={priceText} className="pred-price-value" />
          ) : (
            <span className="pred-price-value">{priceText}</span>
          )}
          {affix.suffix ? <span className="pred-price-unit">{affix.suffix}</span> : null}
        </span>
        <span className={`pred-card-change pred-card-change--${tone}`}>
          {formatChangeRate(item.change_rate)}
        </span>
      </span>

      <span className="pred-card-base">
        기준 종가 {formatMoney(item.base_price, item.market)} <span aria-hidden="true">→</span> 예측
      </span>

      {/* The card's primary graphic. Three shares of one whole, not a lean. */}
      <span className="pred-card-prob">
        {/* No "최다 확률 X" badge here any more. The 보합 band is volatility-scaled and
            therefore wide, so most point forecasts land inside it while the
            distribution still leans — which put the badge on nearly every card, where
            it stopped being a signal. The bar's own legend already prints 하락 47%
            beside the 보합 verdict; the badge only restated it. The modal still
            explains the tension in words on the rows where it matters. */}
        <span className="pred-card-section-label">익일 방향 확률</span>
        <PredictionProbabilityBar item={item} revealed={revealed} compact />
      </span>

      <span className="pred-card-chips">
        {item.reliability_grade ? (
          <span
            className={`pred-chip pred-chip--reliability pred-chip--${RELIABILITY_CLASS[item.reliability_grade]}`}
          >
            신뢰도 {item.reliability_grade}
            {item.reliability !== null ? <b>{item.reliability}</b> : null}
          </span>
        ) : null}
        {/* Only when it says something. The 40/60 blend puts most rows at 확신도 약, so
            printing it on every card spent a chip slot on a constant — the modal still
            carries it for every row, beside the 종합점수 that produced it. */}
        {item.confidence !== "약" ? (
          <span
            className={`pred-chip pred-chip--conf pred-chip--${item.confidence === "강" ? "high" : "mid"}`}
          >
            확신도 {item.confidence}
          </span>
        ) : null}
        {recent && recent.rate !== null ? (
          <span className={`pred-chip pred-chip--accuracy pred-chip--${accuracyTone(recent)}`}>
            20일 적중 {formatAccuracy(recent)}
          </span>
        ) : null}
      </span>

      {item.close_summary ? (
        <span className="pred-card-close">
          <span className="pred-card-section-label">
            장 마감 설명
            {item.close_change_rate !== null ? (
              <b className={`pred-card-close-rate pred-card-close-rate--${
                item.close_change_rate > 0 ? "up" : item.close_change_rate < 0 ? "down" : "flat"
              }`}>
                {formatChangeRate(item.close_change_rate)}
              </b>
            ) : null}
          </span>
          <span className="pred-card-close-text">{item.close_summary}</span>
        </span>
      ) : null}

      <Outcome item={item} />

      {/* The category chips used to live here, but every card in the roster draws on the
          same seven sources, so the row was identical on all twenty — two lines of card
          height carrying no difference between them. The count belongs on the call to
          action, and the categories themselves are in the modal where their values are. */}
      <span className="pred-card-cta">
        근거 {item.evidence.length}건 전체 보기 <span aria-hidden="true">›</span>
      </span>
    </button>
  );
}
