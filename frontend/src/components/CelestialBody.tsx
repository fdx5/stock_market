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
const BASE_R = 34;

/* ───────────────────────────── planet ───────────────────────────── */

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
  ringed?: boolean;
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

/** One half (far or near) of the ring, all lines together. */
function RingHalf({ id, half, R }: { id: string; half: "far" | "near"; R: number }) {
  const halfClip = `rh-${id}-${half}`;

  return (
    <svg className="hb-photo-ring" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={halfClip}>
          <rect x="0" y={half === "far" ? 0 : C} width="100" height={C} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${halfClip})`} transform={`rotate(-12 ${C} ${C})`} opacity={half === "far" ? 0.62 : 1}>
        {SATURN_RING_LINES.map((line, i) => {
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
      {skin.ringed && <RingHalf id={id} half="far" R={R} />}
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
      {skin.ringed && <RingHalf id={id} half="near" R={R} />}
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

      <g clipPath={`url(#${clip})`}>
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
          and it is the last cue separating a sphere from a soft blob. */}
      <circle cx="130" cy="130" r="45.4" fill="none" stroke="#ffe6ae" strokeOpacity="0.26" strokeWidth="0.9" />
      <circle cx="130" cy="130" r="46.5" fill="none" stroke="#ff8f2e" strokeOpacity="0.16" strokeWidth="1.8" />
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
          <stop offset="0%" stopColor="#8d95a3" />
          <stop offset="30%" stopColor="#f4f6fa" />
          <stop offset="55%" stopColor="#ffffff" />
          <stop offset="78%" stopColor="#c7cedb" />
          <stop offset="100%" stopColor="#7b8494" />
        </linearGradient>
        <linearGradient id="rk-fin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e14b3a" />
          <stop offset="100%" stopColor="#9c2a1e" />
        </linearGradient>
        <radialGradient id="rk-flame" cx="50%" cy="0%" r="85%">
          <stop offset="0%" stopColor="#fff6d0" stopOpacity="0.95" />
          <stop offset="35%" stopColor="#ffb454" stopOpacity="0.85" />
          <stop offset="70%" stopColor="#ff6a3d" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#ff6a3d" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* engine flame, trailing behind (below) the craft */}
      <ellipse cx="30" cy="122" rx="10" ry="26" fill="url(#rk-flame)" className="hb-rocket-flame" />

      {/* fins */}
      <path d="M13 92 L2 122 L16 110 Z" fill="url(#rk-fin)" stroke="#6e1a11" strokeWidth="0.6" />
      <path d="M47 92 L58 122 L44 110 Z" fill="url(#rk-fin)" stroke="#6e1a11" strokeWidth="0.6" />

      {/* body */}
      <path
        d="M30 4 C 40 22 44 52 44 92 L16 92 C 16 52 20 22 30 4 Z"
        fill="url(#rk-body)"
        stroke="#5b6270"
        strokeWidth="1"
      />
      {/* nose cap */}
      <path d="M30 4 C 34 12 37 20 38.5 30 L21.5 30 C 23 20 26 12 30 4 Z" fill="#d3392b" stroke="#8a2018" strokeWidth="0.7" />
      {/* body stripe + window */}
      <rect x="16" y="58" width="28" height="6" fill="#d3392b" opacity="0.9" />
      <circle cx="30" cy="46" r="6.5" fill="#274058" stroke="#eef2f8" strokeWidth="1.6" />
      <circle cx="28" cy="44" r="2" fill="#8fc4ff" opacity="0.8" />
    </svg>
  );
}
