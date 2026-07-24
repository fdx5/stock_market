import { PredictionItem } from "../api/client";
import { probabilities } from "../prediction";

const SEGMENTS = [
  { key: "up" as const, label: "상승", tone: "up" },
  { key: "flat" as const, label: "보합", tone: "flat" },
  { key: "down" as const, label: "하락", tone: "down" },
];

/** The three next-session direction probabilities as one stacked bar.
 *
 * This replaces the signed conviction gauge as the card's primary graphic, and the
 * change is the point of the redesign: a diverging bar answers "how strongly does the
 * model lean", which a reader can't act on, while three shares that sum to 100 answer
 * "how likely is each outcome", which they can. The old gauge still appears in the
 * modal, where the 종합점수 it encodes is explained.
 *
 * Segments run 상승 → 보합 → 하락 left to right so the warm end is on the left, matching
 * the Korean market convention every other surface in this app already follows.
 *
 * Renders nothing when the row predates the probability model. A bar that silently
 * showed 0/0/0 would read as a forecast of certainty about nothing.
 */
export default function PredictionProbabilityBar({
  item,
  revealed = true,
  compact = false,
}: {
  item: PredictionItem;
  revealed?: boolean;
  compact?: boolean;
}) {
  const probs = probabilities(item);
  if (!probs) return null;

  return (
    <span className={`pred-prob${compact ? " pred-prob--compact" : ""}`}>
      <span
        className="pred-prob-bar"
        role="img"
        aria-label={`익일 방향 확률: 상승 ${probs.up}%, 보합 ${probs.flat}%, 하락 ${probs.down}%`}
      >
        {SEGMENTS.map((seg) => (
          <span
            key={seg.key}
            className={`pred-prob-seg pred-prob-seg--${seg.tone}`}
            // Collapsed until the card is revealed so the three segments grow into
            // place together — the animation is what makes them read as shares of one
            // whole rather than three unrelated bars.
            style={{ width: revealed ? `${probs[seg.key]}%` : "0%" }}
          >
            {probs[seg.key] >= 14 ? <span className="pred-prob-seg-num">{probs[seg.key]}</span> : null}
          </span>
        ))}
      </span>
      <span className="pred-prob-legend" aria-hidden="true">
        {SEGMENTS.map((seg) => (
          <span key={seg.key} className={`pred-prob-key pred-prob-key--${seg.tone}`}>
            <span className="pred-prob-key-dot" />
            {seg.label} <b>{probs[seg.key]}%</b>
          </span>
        ))}
      </span>
    </span>
  );
}
