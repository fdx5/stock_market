/** Rotating emergency beacon for the gainers/losers tabs — red for a surge, blue
 * for a drop, matching this app's up/down convention.
 *
 * Drawn in side elevation: a mounting base, a glass dome, and a beam sweeping out
 * of it. An earlier version rotated a conic gradient, which is geometrically a plan
 * view — it read as a beacon seen from directly above rather than one sitting on
 * the tab.
 *
 * The turning reflector is conveyed by the two beams firing alternately (light
 * swings left, then right) while the dome flares at twice that rate, since the lamp
 * faces the viewer once on each half turn. Spans rather than an animated image: it
 * stays crisp at any size, takes its colors from the active theme, costs no request,
 * and animates only `opacity` and `transform`, which the compositor handles without
 * repainting a frame.
 */
export default function TabBeacon({ tone }: { tone: "up" | "down" }) {
  return (
    <span className={`tab-beacon tab-beacon--${tone}`} aria-hidden="true">
      <span className="tab-beacon-beam tab-beacon-beam--left" />
      <span className="tab-beacon-beam tab-beacon-beam--right" />
      <span className="tab-beacon-glow" />
      <span className="tab-beacon-dome" />
      <span className="tab-beacon-base" />
    </span>
  );
}
