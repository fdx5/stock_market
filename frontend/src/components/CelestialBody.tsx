/* ============================================================================
   Procedural planets and a star, drawn as SVG.
   ----------------------------------------------------------------------------
   The first pass built these from stacked CSS radial-gradients, which failed on
   two counts. A gradient with a handful of stops bands — the sun's bloom showed
   as four concentric rings and its "granulation" as five hard-edged discs — and
   every glow layer (`inset: -42%`) overflowed its element, which the compositor
   then clipped to a hard rectangle inside the page's preserve-3d subtree.

   Both go away in SVG, and the result is a real surface rather than a painted
   one. The chain per body is:

     1. feTurbulence, stretched horizontally, for latitude banding
     2. a second turbulence displacing the first, for storm curl
     3. desaturate, then feComponentTransfer through a five-colour ramp — the
        albedo (what the surface *is*)
     4. feDiffuseLighting over a finer turbulence, lit from up-and-left — the
        relief (how the surface *catches light*)
     5. multiply the two together

   Step 4 is what stops it looking like a sticker: without it the texture is
   evenly lit and the eye reads a flat disc no matter how good the pattern is.
   On top of that go limb darkening, a terminator, a specular, and a rim light.

   Every body fits a 0 0 100 100 viewBox with the disc at r = 34, leaving margin
   for the atmosphere — so nothing overflows the element and there is nothing to
   clip.
   ========================================================================= */

const C = 50;
/** Default disc radius in the 100-unit box. Ringed bodies shrink it (see
 * `BodySkin.discR`) to make room for the ring, which would otherwise extend past
 * the viewBox and be cut off mid-ellipse. */
const BASE_R = 34;

/* ───────────────────────────── colour ramp ───────────────────────────── */

function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ];
}

/** `feComponentTransfer` tableValues for one channel. A table is a piecewise
 * linear ramp, so five colours give four smooth segments — no stops to band. */
function rampTable(colors: string[], channel: 0 | 1 | 2): string {
  return colors.map((c) => hexToRgb01(c)[channel].toFixed(4)).join(" ");
}

export interface BodySkin {
  /** Darkest to lightest. Five entries reads as a surface; three looks drawn. */
  ramp: string[];
  /** Horizontal frequency far below vertical stretches the noise into latitude
   * bands, which is the strongest single cue that this is a planet. Rocky worlds
   * want the two closer together so the noise reads as terrain instead. */
  freq: [number, number];
  octaves: number;
  /** How hard the second field pushes the first: high for Jovian storm curl,
   * low for quiet terrain. */
  warp: number;
  seed: number;
  /** Relief depth. Rock takes a high value, gas almost none. */
  relief: number;
  /** Atmospheric limb glow. */
  glow: string;
  /** Rim light on the lit edge. */
  rim: string;
  /** Seconds for the surface to drift across the face. */
  spin: number;
  /** Disc radius override, in viewBox units out of 100. Only ringed bodies set
   * it; the ring needs the margin the disc gives up. */
  discR?: number;
  /** A separate high-albedo layer drifting at its own rate, for worlds with
   * weather. Absent on airless bodies. */
  clouds?: { opacity: number; freq: [number, number]; seed: number; spin: number };
  ringed?: boolean;
}

/* ───────────────────────────── planet ───────────────────────────── */

export function PlanetBody({ id, skin }: { id: string; skin: BodySkin }) {
  const R = skin.discR ?? BASE_R;
  // The shell hugs the disc at any radius — see the note on the atmo gradient.
  const atmoR = R * 1.42;
  const surf = `s-${id}`;
  const cloud = `cd-${id}`;
  const shade = `sh-${id}`;
  const spec = `sp-${id}`;
  const atmo = `at-${id}`;
  const clip = `cl-${id}`;
  const ring = `rg-${id}`;
  const ringTop = `rt-${id}`;
  const ringBot = `rb-${id}`;
  const bulge = `bg-${id}`;
  const bulgeMask = `bm-${id}`;

  return (
    <svg className="hb-body" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <filter id={surf} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence
            type="fractalNoise"
            baseFrequency={`${skin.freq[0]} ${skin.freq[1]}`}
            numOctaves={skin.octaves}
            seed={skin.seed}
            result="bands"
          />
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.03"
            numOctaves="3"
            seed={skin.seed + 17}
            result="warp"
          />
          <feDisplacementMap
            in="bands"
            in2="warp"
            scale={skin.warp}
            xChannelSelector="R"
            yChannelSelector="G"
            result="swirled"
          />
          {/* albedo */}
          <feColorMatrix in="swirled" type="saturate" values="0" result="grey" />
          <feComponentTransfer in="grey" result="albedo">
            <feFuncR type="table" tableValues={rampTable(skin.ramp, 0)} />
            <feFuncG type="table" tableValues={rampTable(skin.ramp, 1)} />
            <feFuncB type="table" tableValues={rampTable(skin.ramp, 2)} />
            <feFuncA type="table" tableValues="1 1" />
          </feComponentTransfer>

          {/* relief — the fine field is a height map, lit from the same direction
              as the terminator below so the two agree */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.09"
            numOctaves="4"
            seed={skin.seed + 5}
            result="bump"
          />
          <feDiffuseLighting
            in="bump"
            surfaceScale={skin.relief}
            diffuseConstant="1.05"
            lightingColor="#ffffff"
            result="relief"
          >
            <feDistantLight azimuth="228" elevation="58" />
          </feDiffuseLighting>

          {/* albedo x relief */}
          <feComposite in="albedo" in2="relief" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" />
        </filter>

        {skin.clouds && (
          <filter id={cloud} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence
              type="fractalNoise"
              baseFrequency={`${skin.clouds.freq[0]} ${skin.clouds.freq[1]}`}
              numOctaves="5"
              seed={skin.clouds.seed}
              result="c"
            />
            <feColorMatrix in="c" type="saturate" values="0" result="cg" />
            {/* Only the top of the noise range becomes cloud; the rest is clear
                sky, which is what gives broken cover rather than a white wash. */}
            <feComponentTransfer in="cg">
              <feFuncR type="table" tableValues="1 1" />
              <feFuncG type="table" tableValues="1 1" />
              <feFuncB type="table" tableValues="1 1" />
              <feFuncA type="table" tableValues="0 0 0 0.25 0.85 1" />
            </feComponentTransfer>
          </filter>
        )}

        {/* Limb darkening and terminator, lit from up-and-left to agree with the
            relief above and with the star at the centre of the system. */}
        <radialGradient id={shade} cx="31%" cy="25%" r="92%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.24" />
          <stop offset="14%" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="28%" stopColor="#ffffff" stopOpacity="0.02" />
          <stop offset="40%" stopColor="#000000" stopOpacity="0.12" />
          <stop offset="52%" stopColor="#000000" stopOpacity="0.3" />
          <stop offset="63%" stopColor="#000000" stopOpacity="0.5" />
          <stop offset="73%" stopColor="#000000" stopOpacity="0.68" />
          <stop offset="82%" stopColor="#000000" stopOpacity="0.82" />
          <stop offset="91%" stopColor="#000000" stopOpacity="0.91" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.96" />
        </radialGradient>

        <radialGradient id={spec} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.42" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>

        {/* Atmospheric scattering: a thin bright shell sitting directly on the
            disc's edge. The offsets are relative to `atmoR`, not fixed, because
            the ringed body shrinks its disc — with the stops hardcoded, its
            shell detached from the planet and floated as a separate circle. */}
        <radialGradient id={atmo} cx="50%" cy="50%" r="50%">
          <stop offset="69%" stopColor={skin.glow} stopOpacity="0" />
          <stop offset="70.5%" stopColor={skin.glow} stopOpacity="0.4" />
          <stop offset="74%" stopColor={skin.glow} stopOpacity="0.26" />
          <stop offset="80%" stopColor={skin.glow} stopOpacity="0.13" />
          <stop offset="88%" stopColor={skin.glow} stopOpacity="0.05" />
          <stop offset="95%" stopColor={skin.glow} stopOpacity="0.012" />
          <stop offset="100%" stopColor={skin.glow} stopOpacity="0" />
        </radialGradient>

        <clipPath id={clip}>
          <circle cx={C} cy={C} r={R} />
        </clipPath>

        {/* Foreshortening mask. A sphere's texture is magnified where the surface
            faces the camera and compressed toward the limb; a single flat texture
            has none of that, which is most of why an unaided disc reads as a
            sticker. Showing a scaled-up copy of the same surface through this
            mask reproduces the effect: coarse features at the centre, fine ones
            at the edge. */}
        <radialGradient id={bulge} cx="42%" cy="38%" r="52%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0.82" />
          <stop offset="72%" stopColor="#ffffff" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <mask id={bulgeMask}>
          <rect x="0" y="0" width="100" height="100" fill={`url(#${bulge})`} />
        </mask>

        {skin.ringed && (
          <>
            <linearGradient id={ring} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={skin.glow} stopOpacity="0" />
              <stop offset="14%" stopColor={skin.rim} stopOpacity="0.55" />
              <stop offset="32%" stopColor="#ffffff" stopOpacity="0.72" />
              <stop offset="50%" stopColor={skin.rim} stopOpacity="0.4" />
              <stop offset="68%" stopColor="#ffffff" stopOpacity="0.72" />
              <stop offset="86%" stopColor={skin.rim} stopOpacity="0.55" />
              <stop offset="100%" stopColor={skin.glow} stopOpacity="0" />
            </linearGradient>
            <clipPath id={ringTop}>
              <rect x="0" y="0" width="100" height={C} />
            </clipPath>
            <clipPath id={ringBot}>
              <rect x="0" y={C} width="100" height={C} />
            </clipPath>
          </>
        )}
      </defs>

      <circle cx={C} cy={C} r={atmoR} fill={`url(#${atmo})`} />

      {/* Ring, far half — drawn before the body so the planet occludes it. */}
      {skin.ringed && (
        <g transform={`rotate(-12 ${C} ${C})`} clipPath={`url(#${ringTop})`}>
          <ellipse cx={C} cy={C} rx={R * 1.78} ry={R * 0.4} fill="none" stroke={`url(#${ring})`} strokeWidth="2.6" opacity="0.5" />
          <ellipse cx={C} cy={C} rx={R * 1.42} ry={R * 0.32} fill="none" stroke={`url(#${ring})`} strokeWidth="1.6" opacity="0.4" />
        </g>
      )}

      <g clipPath={`url(#${clip})`}>
        {/* The surface is wider than the disc and drifts across it. The drift
            alternates rather than looping: fractal noise does not tile, so a
            one-way loop would jump at the seam. At this speed it reads as
            weather moving over the face. */}
        <g className="hb-body-drift" style={{ animationDuration: `${skin.spin}s` }}>
          <rect x="-70" y="6" width="240" height="88" filter={`url(#${surf})`} />
        </g>
        <g mask={`url(#${bulgeMask})`}>
          <g className="hb-body-drift" style={{ animationDuration: `${skin.spin}s` }}>
            <g transform={`translate(${C} ${C}) scale(1.75) translate(${-C} ${-C})`}>
              <rect x="-70" y="6" width="240" height="88" filter={`url(#${surf})`} />
            </g>
          </g>
        </g>
        {skin.clouds && (
          <g
            className="hb-body-drift hb-body-drift--alt"
            style={{ animationDuration: `${skin.clouds.spin}s`, opacity: skin.clouds.opacity }}
          >
            <rect x="-70" y="6" width="240" height="88" filter={`url(#${cloud})`} />
          </g>
        )}
        <circle cx={C} cy={C} r={R} fill={`url(#${shade})`} />
        <ellipse cx={C - R * 0.36} cy={C - R * 0.42} rx={R * 0.42} ry={R * 0.32} fill={`url(#${spec})`} />
      </g>

      {/* Rim light on the lit limb only. A full stroke reads as an outline and
          instantly makes the body look drawn rather than lit. */}
      <circle
        cx={C}
        cy={C}
        r={R - 0.4}
        fill="none"
        stroke={skin.rim}
        strokeWidth="0.85"
        strokeOpacity="0.6"
        strokeDasharray={`${2 * Math.PI * R * 0.4} ${2 * Math.PI * R}`}
        transform={`rotate(-152 ${C} ${C})`}
      />

      {/* Ring, near half. */}
      {skin.ringed && (
        <g transform={`rotate(-12 ${C} ${C})`} clipPath={`url(#${ringBot})`}>
          <ellipse cx={C} cy={C} rx={R * 1.78} ry={R * 0.4} fill="none" stroke={`url(#${ring})`} strokeWidth="2.6" opacity="0.9" />
          <ellipse cx={C} cy={C} rx={R * 1.42} ry={R * 0.32} fill="none" stroke={`url(#${ring})`} strokeWidth="1.6" opacity="0.75" />
        </g>
      )}
    </svg>
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
