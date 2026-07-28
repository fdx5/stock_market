/* ============================================================================
   Photographic planets and a procedural star.
   ----------------------------------------------------------------------------
   The seven hub planets used to be procedurally generated noise (feTurbulence
   displaced through a colour ramp, lit with feDiffuseLighting) — good enough to
   read as "a planet" but never close to a photograph, and the filter chain was
   the single heaviest thing on the page: five SVG filter primitives recomputed
   per body, times seven bodies, every frame the "drift" animation ran.

   PhotoPlanetBody replaces that with real equirectangular photography (Solar
   System Scope's CC BY 4.0 texture set, itself built from NASA/JPL imagery —
   see frontend/public/img/planets/ and the source list in Hub.tsx). The globe
   is plain HTML: two copies of the texture sit side by side and slide on
   `transform: translateX`, which is compositor-only work — the browser never
   repaints the pixels, just moves an existing layer — so seven of these
   spinning at once costs a fraction of the old filter chains and the rotation
   reads as continuous, not the old back-and-forth "weather drift". Because an
   equirectangular map's left and right edges are the same meridian, the loop is
   seamless.

   The lighting on top (terminator, limb darkening, specular, atmosphere) stays
   cheap CSS radial-gradients rather than feDiffuseLighting, since a real photo
   already carries its own shading and only needs a light varnish to sit inside
   this scene's own light direction. Only the rim-light arc and Saturn's ring
   stay in SVG, where their geometry (a dashed arc, a stroked/filled ellipse)
   is the natural fit — neither one is part of the rotating layer, so neither
   costs anything per frame.

   The star (StarBody) and the departing probe (VoyagerCraft) below are
   unchanged: procedural SVG, same as before.
   ========================================================================= */

const C = 50;
/** Default disc radius in the 100-unit box the ring/rim overlay SVG shares
 * with the old planet convention. Ringed bodies shrink it (see
 * `PhotoSkin.discR`) to make room for the ring, which would otherwise extend
 * past the viewBox and be cut off mid-ellipse. */
export const BASE_R = 34;

/* ───────────────────────────── planet ───────────────────────────── */

/** Which planet's ring set to draw — see SATURN_RING_LINES / URANUS_RING_LINES
 * below, both real but visually distinct ring systems. */
type RingStyle = "saturn" | "uranus";

export interface PhotoSkin {
  /** Path under /img/planets, e.g. "/img/planets/earth.webp". */
  texture: string;
  /** Seconds for one full, clearly-visible rotation. Deliberately a "reads at a
   * glance" speed rather than a scaled-down real rotation period — Mercury's
   * actual ~59-day spin would just look motionless here. */
  spinSeconds: number;
  /** Venus and Uranus really do rotate retrograde; flipping their spin
   * direction is a small, free nod to that. */
  reverseSpin?: boolean;
  /** Atmospheric limb glow, in this body's own real colour. */
  glow: string;
  /** Disc radius override, in viewBox units out of 100 — see BASE_R. */
  discR?: number;
  ring?: {
    /** Which set of concentric lines and colours to draw — see
     * SATURN_RING_LINES / URANUS_RING_LINES below. */
    style: RingStyle;
    /** Degrees to rotate the whole ring. Saturn's real ~27° axial tilt reads
     * as a fairly open ellipse (-12° here, close to face-on). Uranus's real
     * axial tilt is ~98° — it rotates almost lying on its side — which turns
     * its ring plane roughly 90° from Saturn's; rotating this far past
     * Saturn's angle is what actually shows that difference, since the
     * ellipse's own flatness (ry/rx) stays the same either way and only the
     * angle distinguishes "Saturn's tilt" from "Uranus's tilt" here. */
    tiltDeg: number;
  };
}

/** One concentric line of Saturn's ring, as a fraction of the disc radius R.
 * No band has any real "thickness" here — each is a thin stroked ellipse, and
 * the ring as a whole is just many of these at different radii, brightnesses
 * and colours. That's the deliberate difference from the two earlier passes,
 * which both tried to fill a wide band (first with a real ring-density photo
 * at `multiply`, which just muddied into a flat haze at this element's actual
 * on-screen size; then with solid-coloured annuli, which read as thickness
 * rather than as rings). Many thin concentric lines, bright where real
 * Saturn's B ring is brightest and gapped where the Cassini division actually
 * falls, is what reads as layered circles instead of a dyed swath. */
interface RingLine {
  r: number;
  strokeWidth: number;
  color: string;
  opacity: number;
}

const SATURN_RING_LINES: RingLine[] = [
  { r: 1.16, strokeWidth: 0.55, color: "#a98a55", opacity: 0.4 },
  { r: 1.24, strokeWidth: 0.45, color: "#c9a565", opacity: 0.45 },
  { r: 1.33, strokeWidth: 0.7, color: "#e3c98f", opacity: 0.6 },
  { r: 1.44, strokeWidth: 0.9, color: "#fdf1cf", opacity: 0.85 },
  { r: 1.54, strokeWidth: 0.7, color: "#f2dfab", opacity: 0.8 },
  { r: 1.64, strokeWidth: 0.95, color: "#fffaea", opacity: 0.92 },
  // gap 1.64–1.78: the Cassini division.
  { r: 1.86, strokeWidth: 0.6, color: "#e3c98f", opacity: 0.6 },
  { r: 1.96, strokeWidth: 0.5, color: "#d4b787", opacity: 0.5 },
  { r: 2.06, strokeWidth: 0.4, color: "#f7ecce", opacity: 0.35 },
  { r: 2.18, strokeWidth: 0.35, color: "#f7ecce", opacity: 0.2 },
];

/** Uranus's real rings (13 known) are nothing like Saturn's: dark
 * carbon-rich material at roughly 2% albedo instead of bright ice, narrow
 * instead of broad, and sitting much closer to the planet — the outermost
 * (epsilon, the brightest of a faint set) is only around 2x Uranus's radius
 * versus Saturn's rings reaching past 2.3x. Fewer lines, low opacity, cool
 * greys instead of gold, and a tighter radial span is what keeps this reading
 * as "a different, much fainter ring system" rather than a recolored copy of
 * Saturn's. */
const URANUS_RING_LINES: RingLine[] = [
  { r: 1.14, strokeWidth: 0.3, color: "#7c8593", opacity: 0.3 },
  { r: 1.22, strokeWidth: 0.35, color: "#5c6572", opacity: 0.4 },
  { r: 1.3, strokeWidth: 0.3, color: "#7c8593", opacity: 0.32 },
  // gap — Uranus's rings are individually narrow with real dark gaps between.
  { r: 1.44, strokeWidth: 0.55, color: "#aab4c0", opacity: 0.6 },
  { r: 1.52, strokeWidth: 0.3, color: "#545d69", opacity: 0.28 },
  { r: 1.6, strokeWidth: 0.35, color: "#8a94a2", opacity: 0.35 },
];

const RING_STYLES: Record<RingStyle, RingLine[]> = {
  saturn: SATURN_RING_LINES,
  uranus: URANUS_RING_LINES,
};

/** One half (far or near) of the ring, all lines together. */
function RingHalf({
  id,
  half,
  R,
  lines,
  tiltDeg,
}: {
  id: string;
  half: "far" | "near";
  R: number;
  lines: RingLine[];
  tiltDeg: number;
}) {
  const halfClip = `rh-${id}-${half}`;

  return (
    <svg className="hb-photo-ring" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={halfClip}>
          <rect x="0" y={half === "far" ? 0 : C} width="100" height={C} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${halfClip})`} transform={`rotate(${tiltDeg} ${C} ${C})`} opacity={half === "far" ? 0.62 : 1}>
        {lines.map((line, i) => {
          const rx = line.r * R;
          const ry = rx * 0.225;
          return (
            <ellipse
              key={i}
              cx={C}
              cy={C}
              rx={rx}
              ry={ry}
              fill="none"
              stroke={line.color}
              strokeOpacity={line.opacity}
              strokeWidth={line.strokeWidth}
            />
          );
        })}
      </g>
    </svg>
  );
}

export function PhotoPlanetBody({ id, skin }: { id: string; skin: PhotoSkin }) {
  const R = skin.discR ?? BASE_R;
  const discPct = (R * 2) / 100;

  const style = {
    "--disc-pct": `${(discPct * 100).toFixed(2)}%`,
    "--glow": skin.glow,
  } as React.CSSProperties;

  return (
    <div className="hb-photobody" style={style}>
      {skin.ring && (
        <RingHalf id={id} half="far" R={R} lines={RING_STYLES[skin.ring.style]} tiltDeg={skin.ring.tiltDeg} />
      )}
      <div className="hb-photo-disc">
        <div
          className="hb-photo-spin"
          style={{
            animationDuration: `${skin.spinSeconds}s`,
            animationDirection: skin.reverseSpin ? "reverse" : "normal",
          }}
        >
          <img src={skin.texture} alt="" draggable={false} />
          <img src={skin.texture} alt="" draggable={false} />
        </div>
        <div className="hb-photo-shade" />
        <div className="hb-photo-spec" />
      </div>
      {skin.ring && (
        <RingHalf id={id} half="near" R={R} lines={RING_STYLES[skin.ring.style]} tiltDeg={skin.ring.tiltDeg} />
      )}
    </div>
  );
}

/* ───────────────────────────── star ───────────────────────────── */

/** The sun. Same construction as a planet with the lighting inverted — a star is
 * emissive, so instead of a terminator it gets limb darkening only, and the
 * corona is one densely-sampled falloff rather than the four stops that produced
 * the ring artifacts. The viewBox is 260 wide for a 46-unit photosphere, so the
 * entire bloom lives inside the element. */
export function StarBody({ id }: { id: string }) {
  const surf = `ss-${id}`;
  const clip = `sc-${id}`;
  const limb = `sl-${id}`;
  const corona = `sk-${id}`;
  const bloom = `sb-${id}`;
  const core = `sr-${id}`;
  const bulge = `sg-${id}`;
  const bulgeMask = `sm-${id}`;
  const edge = `se-${id}`;
  const edgeMask = `sf-${id}`;

  return (
    <svg className="hb-starbody" viewBox="0 0 260 260" aria-hidden="true" focusable="false">
      <defs>
        <filter id={surf} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          {/* Granulation: convection cells, so the noise is near-isotropic and
              high frequency rather than banded. */}
          <feTurbulence type="fractalNoise" baseFrequency="0.06 0.05" numOctaves="5" seed="9" result="g1" />
          <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="23" result="g2" />
          <feDisplacementMap in="g1" in2="g2" scale="14" xChannelSelector="R" yChannelSelector="G" result="cells" />
          <feColorMatrix in="cells" type="saturate" values="0" result="grey" />
          <feComponentTransfer in="grey" result="hot">
            <feFuncR type="table" tableValues="0.62 0.93 1 1 1" />
            <feFuncG type="table" tableValues="0.16 0.44 0.74 0.94 1" />
            <feFuncB type="table" tableValues="0.02 0.06 0.2 0.55 0.9" />
            <feFuncA type="table" tableValues="1 1" />
          </feComponentTransfer>
          {/* A shallow relief pass gives the cells edges without implying a solid
              surface — the star still has to read as gas, not rock. */}
          <feTurbulence type="fractalNoise" baseFrequency="0.12" numOctaves="3" seed="41" result="fine" />
          <feDiffuseLighting in="fine" surfaceScale="1.1" diffuseConstant="1.12" lightingColor="#fff" result="rel">
            <feDistantLight azimuth="240" elevation="62" />
          </feDiffuseLighting>
          <feComposite in="hot" in2="rel" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" />
        </filter>

        <clipPath id={clip}>
          <circle cx="130" cy="130" r="46" />
        </clipPath>

        {/* Feathers the last ~10% of the photosphere radius to transparent.
            The granulation filter's noise still has full contrast right up to
            the disc edge; cutting it with a hard circular clip alone lands the
            clip boundary mid-noise-texel, which reads as a jagged, staticky
            rim rather than a clean limb. Fading the surface out just before
            the clip line hides that boundary; the chromosphere ring below
            supplies the actual crisp edge on top of the fade. */}
        <radialGradient id={edge} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="88%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <mask id={edgeMask}>
          <rect x="0" y="0" width="260" height="260" fill={`url(#${edge})`} />
        </mask>

        {/* Foreshortening. A sphere magnifies its surface where it faces the
            camera and compresses it toward the limb; a single evenly-scaled
            texture has none of that, which is the main reason the sun read as a
            flat orange coin. A scaled-up copy of the same photosphere shown
            through this mask gives coarse granules at the centre and fine ones
            at the edge. */}
        <radialGradient id={bulge} cx="43%" cy="39%" r="55%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="40%" stopColor="#ffffff" stopOpacity="0.86" />
          <stop offset="68%" stopColor="#ffffff" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <mask id={bulgeMask}>
          <rect x="0" y="0" width="260" height="260" fill={`url(#${bulge})`} />
        </mask>

        {/* Limb darkening, and much harder than before. A real star dims and
            reddens steeply toward its edge — a shallow falloff is exactly what
            makes a rendered sun look flat. */}
        <radialGradient id={limb} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fffdf2" stopOpacity="0.3" />
          <stop offset="28%" stopColor="#ffeec2" stopOpacity="0.1" />
          <stop offset="50%" stopColor="#ffc169" stopOpacity="0" />
          <stop offset="64%" stopColor="#e8730f" stopOpacity="0.15" />
          <stop offset="76%" stopColor="#c65409" stopOpacity="0.36" />
          <stop offset="86%" stopColor="#9c3806" stopOpacity="0.58" />
          <stop offset="94%" stopColor="#772705" stopOpacity="0.74" />
          <stop offset="100%" stopColor="#4d1502" stopOpacity="0.88" />
        </radialGradient>

        {/* The hot core, deliberately off-centre. Even an emissive body needs an
            asymmetric brightest point for the eye to place it in space; a
            perfectly concentric one reads as a disc every time. */}
        <radialGradient id={core} cx="41%" cy="36%" r="58%">
          <stop offset="0%" stopColor="#fffef8" stopOpacity="0.7" />
          <stop offset="24%" stopColor="#fff4d2" stopOpacity="0.4" />
          <stop offset="50%" stopColor="#ffe0a0" stopOpacity="0.16" />
          <stop offset="76%" stopColor="#ffc571" stopOpacity="0.04" />
          <stop offset="100%" stopColor="#ffb050" stopOpacity="0" />
        </radialGradient>

        {/* Ten stops on a smooth exponential-ish falloff. The four-stop version
            of this is exactly what produced the concentric rings. */}
        <radialGradient id={corona} cx="50%" cy="50%" r="50%">
          <stop offset="17.7%" stopColor="#ffdca8" stopOpacity="0.8" />
          <stop offset="22%" stopColor="#ffc986" stopOpacity="0.55" />
          <stop offset="27%" stopColor="#ffb469" stopOpacity="0.37" />
          <stop offset="33%" stopColor="#ff9f52" stopOpacity="0.24" />
          <stop offset="40%" stopColor="#fa8c41" stopOpacity="0.155" />
          <stop offset="48%" stopColor="#f27c35" stopOpacity="0.098" />
          <stop offset="57%" stopColor="#e86e2c" stopOpacity="0.06" />
          <stop offset="67%" stopColor="#dd6124" stopOpacity="0.034" />
          <stop offset="78%" stopColor="#d1551d" stopOpacity="0.016" />
          <stop offset="89%" stopColor="#c44b17" stopOpacity="0.005" />
          <stop offset="100%" stopColor="#b84212" stopOpacity="0" />
        </radialGradient>

        <radialGradient id={bloom} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff6d8" stopOpacity="0.85" />
          <stop offset="30%" stopColor="#ffe4ac" stopOpacity="0.5" />
          <stop offset="52%" stopColor="#ffcb80" stopOpacity="0.26" />
          <stop offset="72%" stopColor="#ffb15c" stopOpacity="0.1" />
          <stop offset="88%" stopColor="#ff9c45" stopOpacity="0.03" />
          <stop offset="100%" stopColor="#ff8f38" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="130" cy="130" r="130" fill={`url(#${corona})`} className="hb-corona-pulse" />
      <circle cx="130" cy="130" r="78" fill={`url(#${bloom})`} className="hb-bloom-pulse" />

      <g clipPath={`url(#${clip})`} mask={`url(#${edgeMask})`}>
        <g className="hb-body-drift" style={{ animationDuration: "30s" }}>
          <rect x="8" y="68" width="244" height="124" filter={`url(#${surf})`} />
        </g>
        <g mask={`url(#${bulgeMask})`}>
          <g className="hb-body-drift" style={{ animationDuration: "44s" }}>
            <g transform="translate(130 130) scale(1.85) translate(-130 -130)">
              <rect x="8" y="68" width="244" height="124" filter={`url(#${surf})`} />
            </g>
          </g>
        </g>
        <circle cx="130" cy="130" r="46" fill={`url(#${core})`} />
        <circle cx="130" cy="130" r="46" fill={`url(#${limb})`} />
      </g>

      {/* Chromosphere. A real star's edge is a hard bright line against black,
          and it is the last cue separating a sphere from a soft blob. Widened
          from the original 0.9px/1.8px strokes — at this element's typical
          rendered size those fell to well under a device pixel, so browsers
          anti-aliased them into a grainy, flickery-looking ring instead of a
          clean line. Opacity is pulled down to match, so the edge stays the
          same visual weight, just crisp instead of noisy. */}
      <circle cx="130" cy="130" r="45.6" fill="none" stroke="#ffe6ae" strokeOpacity="0.22" strokeWidth="1.5" />
      <circle cx="130" cy="130" r="47" fill="none" stroke="#ff8f2e" strokeOpacity="0.13" strokeWidth="2.6" />
    </svg>
  );
}

/* ───────────────────────────── black hole ───────────────────────────── */

/** Deterministic PRNG, local to this file only — same construction as
 * Hub.tsx's own mulberry32 (used there for the starfield), kept as a
 * separate copy rather than shared since the two call sites want unrelated
 * output (line jitter here, star placement there) and neither is large
 * enough to earn a shared module. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

/** Turns one of the `rgb(r, g, b)` strings lerpColor produces above into an
 * `rgba(...)` at the given alpha — used to key each line-bucket's neon glow
 * (see the drop-shadow filters in BlackHoleBody) to that bucket's own colour
 * along the disc's temperature ramp, rather than one flat glow colour for
 * the whole ring. */
function withAlpha(rgb: string, alpha: number): string {
  return rgb.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
}

/** The disc's real temperature ramp — white-hot inner edge cooling through
 * orange to a dim red outer edge — as stops to interpolate between. Unlike
 * an SVG gradient (which would only shade *across* a single stroke's own
 * width), each of the disc's many individual lines below needs its own solid
 * colour keyed to *where that line sits* radially, which is exactly what
 * sampling this ramp by radial fraction gives it. */
const DISC_RAMP: [number, string][] = [
  [0, "#fffef6"],
  [0.24, "#ffe9b8"],
  [0.52, "#ffb15c"],
  [0.78, "#e8672a"],
  [1, "#7a1f0d"],
];

function discColorAt(frac: number): string {
  const f = Math.min(1, Math.max(0, frac));
  for (let i = 0; i < DISC_RAMP.length - 1; i += 1) {
    const [f0, c0] = DISC_RAMP[i];
    const [f1, c1] = DISC_RAMP[i + 1];
    if (f <= f1 || i === DISC_RAMP.length - 2) {
      return lerpColor(c0, c1, (f - f0) / (f1 - f0));
    }
  }
  return DISC_RAMP[DISC_RAMP.length - 1][1];
}

interface DiscLine {
  rx: number;
  ry: number;
  color: string;
  opacity: number;
  /** stroke-dasharray, in `pathLength="100"` units (see BlackHoleBody) —
   * material along this one line's own fixed ellipse. */
  dash: string;
  /** Seconds for the dash pattern to complete one full lap of this line's
   * own (fixed) ellipse — see the per-line differential note below. */
  flowDur: number;
  /** Negative animation-delay, so every line starts already mid-lap at its
   * own point instead of every ring visibly launching in lockstep. */
  flowDelay: number;
}

/** The disc as hundreds of individually thin concentric ellipses instead of
 * one wide gradient band — a real disc has structure (bright/dim bands,
 * turbulence) at every radius, and hundreds of thin lines read as material
 * the way a single flat stroke never did. Deterministic PRNG so the pattern
 * is identical on every render (see Hub.tsx's starLayer for the same
 * reasoning) — reshuffling on mount would look like the disc's whole
 * structure jumping to a different shape.
 *
 * Each line's own ellipse (rx/ry/tilt) is completely static — same as
 * Saturn's rings elsewhere on this page (see RingHalf above), which read as
 * rotating only because the material circling them does, never because the
 * ring's own shape moves. What actually orbits here is each line's dash
 * pattern, sliding along that one fixed path (see hb-bh-line-flow in
 * hub.css) — a `transform: rotate()` on the shape itself, tried twice
 * before this, either spun the whole tilted ellipse's axis around with it
 * (wrong: a real disc's plane doesn't visibly precess) or, applied per
 * line, made each individual line's own tilt swing independently (worse).
 * Every line's flow duration also varies by radius here — inner lines fast,
 * outer lines slow, like real Keplerian orbits — so the whole disc reads as
 * one coherent ring with material genuinely circling it at different rates,
 * rather than every band pulsing in the same lockstep. */
function buildDiscLines(count: number, innerR: number, outerR: number, ryRatio: number, seed: number): DiscLine[] {
  const rand = mulberry32(seed);
  const lines: DiscLine[] = [];
  for (let i = 0; i < count; i += 1) {
    const frac = i / (count - 1);
    const rx = innerR + (outerR - innerR) * frac;
    const base = 0.85 - frac * 0.72;
    const jitter = 0.55 + rand() * 0.75;
    const dashOn = 11 + rand() * 7;
    const dashOff = 7 + rand() * 7;
    const flowDur = 1.6 + frac ** 1.3 * 7.5 * (0.85 + rand() * 0.3);
    lines.push({
      rx,
      ry: rx * ryRatio,
      color: discColorAt(frac),
      opacity: Math.min(0.95, Math.max(0.04, base * jitter)),
      dash: `${dashOn.toFixed(1)} ${dashOff.toFixed(1)}`,
      flowDur,
      flowDelay: -rand() * flowDur,
    });
  }
  return lines;
}

interface ArcLine {
  d: string;
  color: string;
  opacity: number;
}

/** One bundle of thin lensed-arc lines (the disc's far side, bent up and
 * over one pole). `sign` picks the pole: -1 bows the control point above
 * the horizon, 1 below. Every line's endpoints/peak stay comfortably
 * outside the horizon's own radius (52) — the closest any of them comes is
 * checked by hand at the call site below — so none of this needs to rely on
 * the horizon-on-top occlusion to look right, though that occlusion (see
 * the paint order in BlackHoleBody) still catches it if a line ever did
 * dip inward. */
function buildArcBundle(count: number, seed: number, sign: 1 | -1): ArcLine[] {
  const rand = mulberry32(seed);
  const lines: ArcLine[] = [];
  for (let i = 0; i < count; i += 1) {
    const frac = i / (count - 1);
    const spread = (rand() - 0.5) * 8;
    const x0 = 58 + spread;
    const x1 = 202 - spread;
    const peak = sign === -1 ? -6 - rand() * 30 : 266 + rand() * 30;
    const opacity = Math.min(0.7, Math.max(0.03, (0.5 - frac * 0.34) * (0.6 + rand() * 0.7)));
    lines.push({
      d: `M ${x0.toFixed(1)} 130 Q 130 ${peak.toFixed(1)} ${x1.toFixed(1)} 130`,
      color: discColorAt(0.12 + frac * 0.55),
      opacity,
    });
  }
  return lines;
}

function bucketize<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Computed once at module load — the geometry is fixed per line (each keeps
// its own radius forever; see BlackHoleBody's doc comment on the disc <g>'s
// own spin), so there is nothing per-instance to recompute here even though
// the page can mount more than one of these.
// 1.5x the disc's original 58–124 span (both radii, so the whole ring grows
// as one shape rather than just spreading thinner) per an explicit request.
// Line count has moved 180 → ~20 (each stroked wider, 2.8 vs the original
// 1.15, to compensate) → 40 → 60.
const DISC_OUTER_R = 186;
const DISC_RY_RATIO = 17 / 124;
const DISC_BUCKETS = bucketize(buildDiscLines(60, 87, DISC_OUTER_R, DISC_RY_RATIO, 71827), 6);
const ARC_TOP_BUCKETS = bucketize(buildArcBundle(36, 51013, -1), 6);
const ARC_BOTTOM_BUCKETS = bucketize(buildArcBundle(36, 90210, 1), 6);

/** Gargantua, in miniature — modelled after the actual look of Interstellar's
 * black hole rather than a generic "ringed dot": a thin, nearly edge-on
 * accretion disc made of hundreds of individually thin lines crosses in
 * front of the hole, and that same disc's far side — light bent up and over
 * each pole by the hole's own gravity — reappears as two bundles of lines
 * bowing over the top and bottom of the silhouette. A thin bright photon
 * ring sits right at the horizon's own edge, the last light able to orbit
 * before falling in.
 *
 * Nothing here is a bitmap of the film frame — that's copyrighted footage,
 * not something to embed — this is a fresh procedural reconstruction of the
 * image's well-known structure instead, same as every other body on this
 * page (see StarBody above).
 *
 * The disc's ~90 lines each keep a completely fixed ellipse — same idea as
 * Saturn's rings elsewhere on this page (RingHalf, above): the ring's own
 * shape/tilt never moves, and "it's rotating" reads entirely from the
 * material circling that fixed path, not from the path itself turning.
 * Concretely, each line's own dash pattern (hb-bh-line-flow in hub.css;
 * see buildDiscLines' dash/flowDur/flowDelay) slides along its own static
 * ellipse via `pathLength`+stroke-dashoffset, at a speed that varies by
 * radius — fast inner lines, slow outer ones, like real Keplerian orbits —
 * so the disc reads as one coherent ring with material genuinely orbiting
 * it at different rates. Two earlier attempts got this wrong: rotating the
 * whole tilted group with `transform: rotate()` spun the ring's own axis
 * around with it (a real disc's plane doesn't visibly precess), and doing
 * that per line instead made each individual line's own tilt swing on its
 * own — both are "the shape moving"; this is "the material moving through
 * a shape that never does". The lensed arcs above/below stay still apart
 * from their bucket's own opacity shimmering (hb-bh-shimmer) — they are the
 * far side's bent image, not a second ring with its own orbit.
 *
 * The horizon is opaque and is painted AFTER every disc/arc line, not
 * before — nothing (light included) escapes from behind it, so wherever a
 * line's path would otherwise show through the hole's silhouette, this
 * paint order simply covers it, whole line-bundles at once, without needing
 * per-line clip math. The photon ring is painted after that again, since it
 * traces the horizon's own edge rather than overlapping its face. */
export function BlackHoleBody({ id }: { id: string }) {
  const farBloom = `bh-farbloom-${id}`;
  const bloom = `bh-bloom-${id}`;
  const under = `bh-under-${id}`;
  const horizon = `bh-horizon-${id}`;

  return (
    <svg className="hb-blackhole-body" viewBox="0 0 260 260" aria-hidden="true" focusable="false">
      <defs>
        {/* A third, very large and very faint layer — the outermost bleed,
            reaching almost to the edge of `.hb-blackhole-wrap`'s own extra
            headroom (see hub.css: the wrap is sized 1.9x the visible button
            specifically so glow this size has room to actually spread into
            rather than clipping at the button's own edge). */}
        <radialGradient id={farBloom} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffdca0" stopOpacity="0.28" />
          <stop offset="45%" stopColor="#ffa855" stopOpacity="0.13" />
          <stop offset="100%" stopColor="#ff8a3a" stopOpacity="0" />
        </radialGradient>

        {/* Ambient warm haze, well outside the disc itself — without this the
            hole reads as a flat cutout against the starfield rather than a
            body radiating light like the sun does. Brighter and wider than
            the original pass, per an explicit request for more light
            spreading out around the hole. */}
        <radialGradient id={bloom} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff6e2" stopOpacity="0.7" />
          <stop offset="26%" stopColor="#ffd9a0" stopOpacity="0.4" />
          <stop offset="55%" stopColor="#ffab5c" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#ff7a2e" stopOpacity="0" />
        </radialGradient>

        {/* A softer, closer glow sitting just outside the photon ring. */}
        <radialGradient id={under} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fffaf0" stopOpacity="1" />
          <stop offset="55%" stopColor="#ffbf7a" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ff7a2e" stopOpacity="0" />
        </radialGradient>

        {/* The event horizon itself: not flat #000 (that read as a dead hole
            punched in the page) but a near-black with a faint deep-indigo
            lift toward the rim, as if a last trace of bent starlight still
            reaches the camera from just inside the silhouette's edge. */}
        <radialGradient id={horizon} cx="43%" cy="40%" r="62%">
          <stop offset="0%" stopColor="#000000" />
          <stop offset="70%" stopColor="#020208" />
          <stop offset="100%" stopColor="#0c1024" />
        </radialGradient>
      </defs>

      <circle cx="130" cy="130" r="225" fill={`url(#${farBloom})`} className="hb-bh-breathe" />
      <circle cx="130" cy="130" r="165" fill={`url(#${bloom})`} className="hb-bh-breathe" />
      <circle cx="130" cy="130" r="90" fill="none" stroke={`url(#${under})`} strokeWidth="34" />

      {/* the disc's far side, bent up and over each pole — drawn well before
          the horizon below, so anywhere these dip toward the centre they
          simply disappear behind it. Each bucket also gets a soft neon
          drop-shadow keyed to its own middle line's colour (see withAlpha) —
          a shared filter per bucket rather than one per individual line,
          since a drop-shadow per line (dozens of them) is real per-frame
          filter cost, while one per bucket (a handful) reads the same to
          the eye at this size. */}
      <g aria-hidden="true">
        {ARC_TOP_BUCKETS.map((bucket, bi) => (
          <g
            key={`t${bi}`}
            className="hb-bh-shimmer"
            style={{
              animationDelay: `${-(bi * 0.6)}s`,
              animationDuration: `${5 + (bi % 4)}s`,
              filter: `drop-shadow(0 0 3px ${withAlpha(bucket[Math.floor(bucket.length / 2)].color, 0.55)})`,
            }}
          >
            {bucket.map((line, li) => (
              <path key={li} d={line.d} fill="none" stroke={line.color} strokeOpacity={line.opacity} strokeWidth="1.1" strokeLinecap="round" />
            ))}
          </g>
        ))}
        {ARC_BOTTOM_BUCKETS.map((bucket, bi) => (
          <g
            key={`b${bi}`}
            className="hb-bh-shimmer"
            style={{
              animationDelay: `${-(bi * 0.6 + 0.3)}s`,
              animationDuration: `${5.4 + (bi % 4)}s`,
              filter: `drop-shadow(0 0 3px ${withAlpha(bucket[Math.floor(bucket.length / 2)].color, 0.55)})`,
            }}
          >
            {bucket.map((line, li) => (
              <path key={li} d={line.d} fill="none" stroke={line.color} strokeOpacity={line.opacity} strokeWidth="1.1" strokeLinecap="round" />
            ))}
          </g>
        ))}
      </g>

      {/* the disc's near side, crossing directly across the hole — each
          line's own ellipse (rx/ry/tilt) is completely static, Saturn-ring
          style; only its dash pattern slides along that fixed path
          (line.dash/flowDur/flowDelay, fast inner lines to slow outer ones;
          see buildDiscLines), which is what reads as material orbiting a
          ring rather than the ring itself turning. pathLength="100" lets
          the dash values/animation below be expressed as a flat percentage
          of one full lap regardless of each line's own real circumference,
          so the same -100 dashoffset keyframe loops seamlessly for every
          line at once. Bucketed for the shimmer, and for a soft neon
          drop-shadow keyed to that bucket's own colour along the ramp (see
          the arc bundles above for why this is per-bucket, not per-line). */}
      <g aria-hidden="true">
        {DISC_BUCKETS.map((bucket, bi) => (
          <g
            key={bi}
            className="hb-bh-shimmer"
            style={{
              animationDelay: `${-(bi * 0.45)}s`,
              animationDuration: `${4.2 + (bi % 5) * 0.6}s`,
              filter: `drop-shadow(0 0 4px ${withAlpha(bucket[Math.floor(bucket.length / 2)].color, 0.6)})`,
            }}
          >
            {bucket.map((line, li) => (
              <ellipse
                key={li}
                cx="130"
                cy="130"
                rx={line.rx}
                ry={line.ry}
                pathLength={100}
                fill="none"
                stroke={line.color}
                strokeOpacity={line.opacity}
                strokeWidth="2.8"
                strokeDasharray={line.dash}
                className="hb-bh-line-flow"
                style={{ animationDuration: `${line.flowDur.toFixed(2)}s`, animationDelay: `${line.flowDelay.toFixed(2)}s` }}
              />
            ))}
          </g>
        ))}
      </g>

      {/* event horizon — opaque, and painted last of the disc/arc stack, so
          it hides every line above wherever they'd otherwise show through
          it. Nothing behind this circle is ever visible past its edge. */}
      <circle cx="130" cy="130" r="52" fill={`url(#${horizon})`} />

      {/* photon ring — thin and true bright, tracing the horizon's own edge
          rather than its face, so it belongs on top of the horizon rather
          than behind it. Static; it's the horizon's own edge, not a
          separate moving part. */}
      <circle cx="130" cy="130" r="52" fill="none" stroke="#fff8e8" strokeWidth="1.7" opacity="0.95" />
      <circle cx="130" cy="130" r="54" fill="none" stroke="#ffb168" strokeWidth="3.2" opacity="0.4" />
    </svg>
  );
}

/* ───────────────────────────── spacecraft ───────────────────────────── */

/** A deep-space probe, drawn rather than photographed.
 *
 * There is no spacecraft bitmap in the project, and this renders at 60-100px,
 * so the constraint that matters is legibility at that size rather than
 * fidelity. The first version modelled Voyager literally — dish, magnetometer
 * boom, RTG stack — and at 80px the booms collapsed into grey hairlines and the
 * craft read as a smudge. This is a cleaner airframe built from fewer, bolder
 * masses: two large solar wings, a foil-wrapped bus, a high-gain dish and a lit
 * engine bell.
 *
 * Everything is shaded from one direction — the system it is leaving, behind and
 * below — with real three-tone metal (specular, body, shadow), panel seams, and
 * an actual cell grid on the arrays. Detail at that density is what makes a
 * vector craft read as machined hardware rather than an icon.
 */
export function VoyagerCraft() {
  return (
    <svg viewBox="0 0 240 130" className="hb-voyager-art" aria-hidden="true" focusable="false">
      <defs>
        {/* Solar cells: a real grid, not a flat blue fill. */}
        <pattern id="vc-cells" width="6" height="5" patternUnits="userSpaceOnUse">
          <rect width="6" height="5" fill="#12294f" />
          <rect width="5.2" height="4.2" x="0.4" y="0.4" fill="#1d3f77" />
          <rect width="5.2" height="1.5" x="0.4" y="0.4" fill="#2a5596" opacity="0.75" />
        </pattern>
        {/* Sheen raking across the arrays, so they read as glass, not paper. */}
        <linearGradient id="vc-sheen" x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0%" stopColor="#8fc4ff" stopOpacity="0.42" />
          <stop offset="26%" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="48%" stopColor="#5f9de0" stopOpacity="0.05" />
          <stop offset="72%" stopColor="#ffffff" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#2b5f9e" stopOpacity="0.3" />
        </linearGradient>
        {/* Gold multi-layer insulation. */}
        <linearGradient id="vc-foil" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#ffeaa9" />
          <stop offset="22%" stopColor="#e8bf58" />
          <stop offset="52%" stopColor="#b8891f" />
          <stop offset="78%" stopColor="#8a6416" />
          <stop offset="100%" stopColor="#513a0b" />
        </linearGradient>
        <linearGradient id="vc-metal" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#f2f5fa" />
          <stop offset="35%" stopColor="#c2cad8" />
          <stop offset="70%" stopColor="#798394" />
          <stop offset="100%" stopColor="#3d4451" />
        </linearGradient>
        <radialGradient id="vc-dish" cx="46%" cy="22%" r="86%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="30%" stopColor="#eef2f8" />
          <stop offset="58%" stopColor="#b9c2d0" />
          <stop offset="82%" stopColor="#7d8798" />
          <stop offset="100%" stopColor="#454d5b" />
        </radialGradient>
        <radialGradient id="vc-plume" cx="12%" cy="50%" r="88%">
          <stop offset="0%" stopColor="#dff0ff" stopOpacity="0.95" />
          <stop offset="30%" stopColor="#6fb4ff" stopOpacity="0.5" />
          <stop offset="70%" stopColor="#3d7fe0" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#2a5cb8" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ── solar arrays ── */}
      <g transform="skewY(-7)">
        <rect x="16" y="56" width="76" height="33" rx="1.5" fill="url(#vc-cells)" />
        <rect x="16" y="56" width="76" height="33" rx="1.5" fill="url(#vc-sheen)" />
        <rect x="16" y="56" width="76" height="33" rx="1.5" fill="none" stroke="#aab6c8" strokeWidth="1.1" />
        <path d="M41 56 V89 M66 56 V89 M16 72.5 H92" stroke="#93a1b6" strokeWidth="0.75" opacity="0.8" />

        <rect x="148" y="38" width="76" height="33" rx="1.5" fill="url(#vc-cells)" />
        <rect x="148" y="38" width="76" height="33" rx="1.5" fill="url(#vc-sheen)" />
        <rect x="148" y="38" width="76" height="33" rx="1.5" fill="none" stroke="#aab6c8" strokeWidth="1.1" />
        <path d="M173 38 V71 M198 38 V71 M148 54.5 H224" stroke="#93a1b6" strokeWidth="0.75" opacity="0.8" />
      </g>

      {/* yokes */}
      <path d="M92 66 L112 62 M148 48 L130 53" stroke="#c3cddb" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M92 66 L112 62 M148 48 L130 53" stroke="#6e7889" strokeWidth="1" strokeLinecap="round" />

      {/* ── engine bell and plume, at the trailing end ── */}
      <ellipse cx="84" cy="76" rx="26" ry="8" fill="url(#vc-plume)" transform="rotate(-8 84 76)" />
      <path d="M113 66 L104 61 L102 73 L111 77 Z" fill="url(#vc-metal)" stroke="#596373" strokeWidth="0.7" />

      {/* ── bus ── */}
      <path
        d="M112 46 L134 40 L152 50 L150 70 L128 78 L110 67 Z"
        fill="url(#vc-foil)"
        stroke="#ffeaa9"
        strokeWidth="0.9"
        strokeOpacity="0.55"
      />
      {/* foil seams — the crinkle that makes insulation read as insulation */}
      <path
        d="M118 44 L124 74 M128 42 L134 76 M140 42 L142 72 M110 56 L150 50 M112 64 L149 60"
        stroke="#5c4310"
        strokeWidth="0.55"
        strokeOpacity="0.5"
      />
      <path d="M120 43.5 L126 73.5 M130 41.5 L136 75.5" stroke="#ffe9a6" strokeWidth="0.4" strokeOpacity="0.45" />
      <rect x="126" y="52" width="15" height="12" rx="1.5" fill="#2b303a" stroke="#9aa4b4" strokeWidth="0.7" />
      <path d="M128 55 H139 M128 58 H139 M128 61 H139" stroke="#6d7789" strokeWidth="0.6" />

      {/* ── high-gain antenna, held back toward the inner system ── */}
      <g transform="rotate(-20 176 84)">
        <path d="M152 62 L168 76" stroke="#aab4c4" strokeWidth="2.6" strokeLinecap="round" />
        <ellipse cx="176" cy="84" rx="26" ry="16.5" fill="url(#vc-dish)" />
        <ellipse cx="176" cy="84" rx="26" ry="16.5" fill="none" stroke="#f4f7fc" strokeWidth="1.7" strokeOpacity="0.9" />
        <ellipse cx="176" cy="84" rx="17" ry="10.8" fill="none" stroke="#8f99a9" strokeWidth="0.6" strokeOpacity="0.6" />
        <ellipse cx="176" cy="84" rx="8.5" ry="5.4" fill="none" stroke="#8f99a9" strokeWidth="0.6" strokeOpacity="0.55" />
        <path
          d="M176 68 V100 M150 84 H202 M162 73 L190 95 M190 73 L162 95"
          stroke="#8f99a9"
          strokeWidth="0.42"
          strokeOpacity="0.34"
        />
        <path d="M176 84 L170 70 M176 84 L183 70" stroke="#c8d1de" strokeWidth="0.9" />
        <ellipse cx="176" cy="68" rx="4.4" ry="2.4" fill="#e6ebf3" stroke="#798394" strokeWidth="0.6" />
        {/* lit inner lip of the far wall */}
        <path d="M153 80 A26 16.5 0 0 1 199 80" fill="none" stroke="#ffffff" strokeWidth="1.1" strokeOpacity="0.5" />
      </g>

      {/* ── masts ── */}
      <path d="M134 40 L150 15" stroke="#9aa4b4" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="150" cy="15" r="2.6" fill="#dfe6f0" stroke="#798394" strokeWidth="0.6" />
      <path d="M112 46 L90 27" stroke="#8d97a8" strokeWidth="1.1" strokeOpacity="0.8" />

      {/* ── one hard specular, from the star it is leaving ── */}
      <ellipse cx="130" cy="45" rx="12" ry="3.4" fill="#fffdf2" opacity="0.5" transform="rotate(-17 130 45)" />
      <ellipse cx="196" cy="66" rx="7" ry="2.6" fill="#ffffff" opacity="0.42" transform="rotate(-28 196 66)" />
    </svg>
  );
}

/* ───────────────────────────── satellite ───────────────────────────── */

/** A small generic comsat bus for Earth's two orbiters (Samsung, SK hynix —
 * see Hub.tsx's `.hb-moon` satellites). Replaces the previous plain circular
 * badge with a pair of blue rectangle "wings" bolted on: at 40px that read as
 * a coin with tabs, not a spacecraft. This is a proper (if schematic) comsat
 * silhouette instead — a ribbed solar array on each side of a boxy bus, with
 * a mast and dish canted off the top for an antenna — built from the same
 * bold-mass, few-parts approach as RocketCraft below, since anything finer
 * than that collapses at this render size. The company logo (a raster asset,
 * so not drawn here) sits on top as the bus's payload/sensor plate; see
 * `.hb-moon-logo` in hub.css for how it's centred on this SVG's own (50, 50)
 * bus centre. */
export function SatelliteCraft() {
  return (
    <svg viewBox="0 0 100 100" className="hb-sat-art" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="sat-panel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#9ecbf5" />
          <stop offset="45%" stopColor="#3f74ad" />
          <stop offset="100%" stopColor="#1c3c63" />
        </linearGradient>
        <linearGradient id="sat-bus" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f2f4f8" />
          <stop offset="45%" stopColor="#c7ced9" />
          <stop offset="100%" stopColor="#828b9b" />
        </linearGradient>
      </defs>

      {/* solar arrays, each ribbed into cells so the panel reads as an array
          rather than a flat tab */}
      <g stroke="#0f2440" strokeWidth="0.9">
        <rect x="2" y="37" width="26" height="26" rx="1.2" fill="url(#sat-panel)" />
        <line x1="9.7" y1="37" x2="9.7" y2="63" opacity="0.6" />
        <line x1="17.3" y1="37" x2="17.3" y2="63" opacity="0.6" />
        <line x1="24.7" y1="37" x2="24.7" y2="63" opacity="0.6" />
        <line x1="2" y1="50" x2="28" y2="50" opacity="0.45" />

        <rect x="72" y="37" width="26" height="26" rx="1.2" fill="url(#sat-panel)" />
        <line x1="79.7" y1="37" x2="79.7" y2="63" opacity="0.6" />
        <line x1="87.3" y1="37" x2="87.3" y2="63" opacity="0.6" />
        <line x1="94.7" y1="37" x2="94.7" y2="63" opacity="0.6" />
        <line x1="72" y1="50" x2="98" y2="50" opacity="0.45" />
      </g>

      {/* booms carrying the arrays out from the bus */}
      <rect x="28" y="47.5" width="9" height="5" fill="#9aa3b2" />
      <rect x="63" y="47.5" width="9" height="5" fill="#9aa3b2" />

      {/* antenna: mast canted off the bus, dish at its tip */}
      <line x1="52" y1="31" x2="61" y2="14" stroke="#9aa3b2" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="62" cy="12" r="4.6" fill="#e4e9f0" stroke="#828b9b" strokeWidth="1" />
      <circle cx="62" cy="12" r="1.4" fill="#828b9b" />

      {/* bus */}
      <rect x="33" y="31" width="34" height="38" rx="3.5" fill="url(#sat-bus)" stroke="#5b6270" strokeWidth="1.3" />
      {/* thruster nozzle */}
      <rect x="44" y="67" width="12" height="8" rx="1.6" fill="#4b5262" stroke="#282d38" strokeWidth="0.8" />
    </svg>
  );
}

/* ───────────────────────────── rocket ───────────────────────────── */

/** A generic two-stage rocket for the Earth→Mars run (see Hub.tsx's
 * `.hb-rocket-*` orbiter). Deliberately not a reproduction of any real launch
 * provider's actual wordmark/logo — a decorative flourish on a public page
 * isn't the kind of "identify this company" use the site's stock logos are
 * (those label the actual companies being tracked); this is drawn in the same
 * hand-built vector language as VoyagerCraft above instead, with its own
 * paint scheme so the two read as distinct craft. */
export function RocketCraft() {
  return (
    <svg viewBox="0 0 60 140" className="hb-rocket-art" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="rk-body" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#7d8494" />
          <stop offset="22%" stopColor="#eef1f7" />
          <stop offset="48%" stopColor="#ffffff" />
          <stop offset="62%" stopColor="#dfe4ee" />
          <stop offset="82%" stopColor="#aab1c1" />
          <stop offset="100%" stopColor="#6d7583" />
        </linearGradient>
        <linearGradient id="rk-fin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ea5a46" />
          <stop offset="100%" stopColor="#8f2519" />
        </linearGradient>
        <linearGradient id="rk-nozzle" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4b5262" />
          <stop offset="55%" stopColor="#282d38" />
          <stop offset="100%" stopColor="#111318" />
        </linearGradient>
        <radialGradient id="rk-flame-outer" cx="50%" cy="0%" r="85%">
          <stop offset="0%" stopColor="#fff6d0" stopOpacity="0.9" />
          <stop offset="35%" stopColor="#ffb454" stopOpacity="0.8" />
          <stop offset="70%" stopColor="#ff6a3d" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#ff6a3d" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="rk-flame-core" cx="50%" cy="0%" r="80%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="50%" stopColor="#ffe49a" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffb454" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* engine flame, trailing behind (below) the craft — a wider soft outer
          plume plus a brighter, faster-flickering inner core for some depth */}
      <ellipse cx="30" cy="120" rx="11" ry="28" fill="url(#rk-flame-outer)" className="hb-rocket-flame" />
      <ellipse cx="30" cy="116" rx="5.5" ry="17" fill="url(#rk-flame-core)" className="hb-rocket-flame hb-rocket-flame--core" />

      {/* engine nozzle, grounding the flame into the hull */}
      <path d="M18 90 L42 90 L37 100 L23 100 Z" fill="url(#rk-nozzle)" stroke="#05060a" strokeWidth="0.6" />

      {/* fins */}
      <path d="M13 88 L2 120 L16 106 Z" fill="url(#rk-fin)" stroke="#6e1a11" strokeWidth="0.6" />
      <path d="M47 88 L58 120 L44 106 Z" fill="url(#rk-fin)" stroke="#6e1a11" strokeWidth="0.6" />

      {/* body */}
      <path
        d="M30 4 C 40 22 44 52 44 90 L16 90 C 16 52 20 22 30 4 Z"
        fill="url(#rk-body)"
        stroke="#5b6270"
        strokeWidth="1"
      />
      {/* gloss highlight down the sunlit side */}
      <path d="M23 14 C 20 34 18.5 58 18.5 84 L22 84 C 22 58 23.5 34 27 14 Z" fill="#ffffff" opacity="0.35" />
      {/* nose cap */}
      <path d="M30 4 C 34 12 37 20 38.5 30 L21.5 30 C 23 20 26 12 30 4 Z" fill="#d3392b" stroke="#8a2018" strokeWidth="0.7" />
      {/* body stripe + window */}
      <rect x="16" y="58" width="28" height="6" fill="#d3392b" opacity="0.9" />
      <circle cx="30" cy="46" r="6.5" fill="#274058" stroke="#eef2f8" strokeWidth="1.6" />
      <circle cx="28" cy="44" r="2" fill="#8fc4ff" opacity="0.8" />
    </svg>
  );
}
