import type { IndicatorPoint } from "../api/client";
import { useT } from "../i18n/LanguageContext";

type Tone = "bull" | "bear" | "warn" | "neutral";

interface Badge {
  key: string;
  label: string;
  tone: Tone;
  hint: string;
}

const OVERBOUGHT = 70;
const OVERSOLD = 30;
// A day's volume has to clearly beat its own 20-day average before it's worth
// calling out — anything nearer 1.0x is just an ordinary session.
const VOLUME_SURGE_RATIO = 1.5;

function num(value: number | null | undefined): number | null {
  return value === null || value === undefined || Number.isNaN(value) ? null : value;
}

/** Distils the indicator series the chart already loaded into the four or five
 * signals a visitor would otherwise have to read the RSI/MACD panels to get.
 * Purely derived — no extra request, and it renders nothing until the series
 * arrives. */
function buildBadges(latest: IndicatorPoint, prev: IndicatorPoint | null, t: (s: string) => string): Badge[] {
  const badges: Badge[] = [];

  const sma5 = num(latest.sma5);
  const sma20 = num(latest.sma20);
  const sma60 = num(latest.sma60);

  if (sma5 !== null && sma20 !== null && sma60 !== null) {
    if (sma5 > sma20 && sma20 > sma60) {
      badges.push({
        key: "align",
        label: t("정배열"),
        tone: "bull",
        hint: t("5일선 > 20일선 > 60일선"),
      });
    } else if (sma5 < sma20 && sma20 < sma60) {
      badges.push({
        key: "align",
        label: t("역배열"),
        tone: "bear",
        hint: t("5일선 < 20일선 < 60일선"),
      });
    }
  }

  // Only the *crossing* day is interesting; a 5-over-20 state that's been true for
  // weeks is already covered by the 정배열 badge above.
  const prevSma5 = num(prev?.sma5);
  const prevSma20 = num(prev?.sma20);
  if (sma5 !== null && sma20 !== null && prevSma5 !== null && prevSma20 !== null) {
    if (prevSma5 <= prevSma20 && sma5 > sma20) {
      badges.push({ key: "cross", label: t("골든크로스"), tone: "bull", hint: t("5일선이 20일선을 상향 돌파") });
    } else if (prevSma5 >= prevSma20 && sma5 < sma20) {
      badges.push({ key: "cross", label: t("데드크로스"), tone: "bear", hint: t("5일선이 20일선을 하향 돌파") });
    }
  }

  const rsi = num(latest.rsi14);
  if (rsi !== null) {
    const tone: Tone = rsi >= OVERBOUGHT ? "warn" : rsi <= OVERSOLD ? "warn" : "neutral";
    const state = rsi >= OVERBOUGHT ? t("과매수") : rsi <= OVERSOLD ? t("과매도") : t("중립");
    badges.push({
      key: "rsi",
      label: `RSI ${rsi.toFixed(0)} · ${state}`,
      tone,
      hint: t("RSI(14) · 70 이상 과매수, 30 이하 과매도"),
    });
  }

  const close = num(latest.close);
  const upper = num(latest.bb_upper);
  const lower = num(latest.bb_lower);
  if (close !== null && upper !== null && close >= upper) {
    badges.push({ key: "bb", label: t("볼린저 상단"), tone: "warn", hint: t("종가가 볼린저밴드 상단 위") });
  } else if (close !== null && lower !== null && close <= lower) {
    badges.push({ key: "bb", label: t("볼린저 하단"), tone: "warn", hint: t("종가가 볼린저밴드 하단 아래") });
  }

  const volumeMa = num(latest.volume_ma20);
  if (volumeMa !== null && volumeMa > 0) {
    const ratio = latest.volume / volumeMa;
    if (ratio >= VOLUME_SURGE_RATIO) {
      badges.push({
        key: "volume",
        label: `${t("거래량 급증")} ${ratio.toFixed(1)}x`,
        tone: "warn",
        hint: t("20일 평균 거래량 대비"),
      });
    }
  }

  return badges;
}

export default function IndicatorBadges({ points }: { points: IndicatorPoint[] }) {
  const t = useT();
  if (points.length === 0) return null;

  const latest = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const badges = buildBadges(latest, prev, t);
  if (badges.length === 0) return null;

  return (
    <div className="indicator-badges" role="list">
      {badges.map((badge) => (
        <span key={badge.key} className={`indicator-badge is-${badge.tone}`} role="listitem" title={badge.hint}>
          {badge.label}
        </span>
      ))}
    </div>
  );
}
