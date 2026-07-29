import { useEffect, useMemo, useRef, useState } from "react";
import { GlobalIndexWidget, IndexQuote, api } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link, navigate } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import { BASE_R, BlackHoleBody, PhotoPlanetBody, PhotoSkin, RocketCraft, SatelliteCraft, StarBody, SupernovaGas, VoyagerCraft } from "./CelestialBody";
import LanguageToggle from "./LanguageToggle";
import StockIcon from "./StockIcon";
import ThemeToggle from "./ThemeToggle";
import "./hub.css";

/* ============================================================================
   ORBIT — the site's entrance.
   ----------------------------------------------------------------------------
   Not a dashboard. Everything the old landing page did (tables, heat maps,
   forecast cards) lives one click away at /dashboard; this page's whole job is
   to be the front door and to make choosing a destination feel like something.

   The star is the hub itself and opens the dashboard. Seven planets orbit it,
   one per section of the site. The four market planets carry their index's
   move today — that is the entire information budget of the page, deliberately.

   Built with CSS 3D transforms rather than a WebGL dependency: the project
   ships plain CSS with no framework, and a tilted `preserve-3d` plane with
   counter-rotated billboards gets a real perspective solar system for the cost
   of a stylesheet.
   ========================================================================= */

const INDEX_POLL_MS = 30_000;

interface PlanetSpec {
  key: string;
  to: string;
  ko: string;
  en: string;
  /** Orbit radius and body diameter in design pixels, scaled by CSS at smaller
   * viewports (see --orbit-scale / --body-scale in hub.css). */
  radius: number;
  size: number;
  /** Seconds for one full revolution. */
  duration: number;
  /** Where on the ring it starts, 0..1 — applied as a negative animation-delay
   * so the planet and its counter-rotating billboard stay locked together. */
  phase: number;
  /** Real photographic texture + lighting — see CelestialBody.tsx. */
  skin: PhotoSkin;
  /** Which live index (if any) prints on the body. */
  feed?: "KOSPI" | "KOSDAQ" | "SPX" | "NDX";
}

/* One ring per planet, in real solar-system order (Mercury innermost through
   Uranus outermost). Radii are spread further apart than the first pass at
   this reorder — Earth/Mars and Saturn/Uranus originally landed on the exact
   same radius (338 and 512 respectively), sharing one visual track apiece —
   now strictly increasing with a widening gap outward (150→610), which is
   also why hub.css's --orbit-unit clamp divisors were rescaled to match the
   new 610 outer radius (see that comment). `size` is independent of the
   orbit and is graded to each planet's actual relative scale instead (Jupiter
   biggest, Mercury smallest; Saturn sized up further so its ring has room to
   read). Sizes are the container's, and the disc inside it is 68% of that by
   default (CelestialBody's BASE_R = 34 in a 100-unit box). */
const PLANETS: PlanetSpec[] = [
  {
    key: "mercury",
    to: "/news",
    ko: "글로벌 뉴스",
    en: "GLOBAL NEWS",
    radius: 150,
    size: 60,
    duration: 34,
    phase: 0.06,
    skin: {
      texture: "/img/planets/mercury.webp",
      spinSeconds: 9,
      glow: "#c9beae",
    },
  },
  {
    key: "venus",
    to: "/kosdaq-map",
    ko: "코스닥",
    en: "KOSDAQ",
    radius: 215,
    size: 86,
    duration: 40,
    phase: 0.56,
    feed: "KOSDAQ",
    skin: {
      texture: "/img/planets/venus.webp",
      spinSeconds: 13,
      // Venus's real rotation is retrograde.
      reverseSpin: true,
      glow: "#f5e2ab",
    },
  },
  {
    key: "earth",
    to: "/map",
    ko: "코스피",
    en: "KOSPI",
    radius: 285,
    size: 90,
    duration: 50,
    phase: 0.2,
    feed: "KOSPI",
    skin: {
      texture: "/img/planets/earth.webp",
      spinSeconds: 11,
      glow: "#5fa8ff",
    },
  },
  {
    key: "mars",
    to: "/nasdaq100-map",
    ko: "나스닥 100",
    en: "NASDAQ 100",
    radius: 355,
    size: 68,
    duration: 58,
    phase: 0.68,
    feed: "NDX",
    skin: {
      texture: "/img/planets/mars.webp",
      spinSeconds: 10,
      glow: "#ff8f5c",
    },
  },
  {
    key: "jupiter",
    to: "/sp500-map",
    ko: "S&P 500",
    en: "S&P 500",
    radius: 440,
    size: 132,
    duration: 74,
    phase: 0.78,
    feed: "SPX",
    skin: {
      texture: "/img/planets/jupiter.webp",
      spinSeconds: 16,
      glow: "#e0b177",
    },
  },
  {
    key: "saturn",
    to: "/ai-prediction",
    ko: "AI 예측",
    en: "AI FORECAST",
    radius: 525,
    size: 150,
    duration: 66,
    phase: 0.42,
    skin: {
      texture: "/img/planets/saturn.webp",
      spinSeconds: 18,
      glow: "#e8cf9a",
      discR: 25,
      ring: { style: "saturn", tiltDeg: -12 },
    },
  },
  {
    key: "uranus",
    to: "/fight",
    ko: "시총 대결",
    en: "CAP BATTLE",
    radius: 610,
    size: 78,
    duration: 84,
    phase: 0.14,
    skin: {
      texture: "/img/planets/uranus.webp",
      spinSeconds: 14,
      // Uranus's real rotation is retrograde (its axis is tipped ~98°, but a
      // full barrel-roll is out of scope for this billboard). That same ~98°
      // tilt is also why its ring gets a tiltDeg 90° past Saturn's — see
      // PhotoSkin.ring's comment in CelestialBody.tsx.
      reverseSpin: true,
      glow: "#8fe9e0",
      ring: { style: "uranus", tiltDeg: 78 },
    },
  },
  {
    key: "neptune",
    to: "/battle",
    ko: "삼성 vs 하이닉스",
    en: "Samsung vs Hynix",
    // The outermost ring, past Uranus's 610 — same spacing step (~85-95) the
    // radii already climb by further out in the list.
    radius: 700,
    // Same size as Uranus per an explicit request, rather than following the
    // usual "outer planets read bigger" pattern the rest of the list uses.
    size: 78,
    duration: 104,
    phase: 0.32,
    skin: {
      texture: "/img/planets/neptune.webp",
      spinSeconds: 15,
      glow: "#4d6dff",
    },
  },
];

/* ───────────────────────────── starfield ───────────────────────────── */

/** Deterministic PRNG so the sky is identical on every render — a re-render
 * that reshuffled every star would read as the whole field flickering. */
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

/** Real starlight isn't uniformly white — a star's colour is its surface
 * temperature (blue-white hottest, down through white and yellow-white to
 * orange and red coolest), and a wide-field photo of the night sky shows all
 * of those at once. Weighted so the field still reads as "mostly white" at a
 * glance (real skies are, and an even split would look like confetti) while
 * a clear minority visibly read as teal, orange or red — an explicit request
 * for variety over strict realism. Each entry is [r, g, b, weight]. */
const STAR_PALETTE: [number, number, number, number][] = [
  [255, 255, 255, 0.32], // white
  [210, 225, 255, 0.18], // blue-white
  [255, 244, 214, 0.16], // warm white / yellow-white
  [120, 235, 224, 0.1], // teal
  [255, 176, 102, 0.14], // orange
  [255, 106, 92, 0.1], // red
];
const STAR_PALETTE_TOTAL = STAR_PALETTE.reduce((sum, [, , , w]) => sum + w, 0);

/** Picks one palette colour, weighted, and returns it as an "r, g, b" string
 * ready to drop into `rgba(${c}, alpha)` or `rgb(${c})`. */
function pickStarColor(rand: () => number): string {
  let roll = rand() * STAR_PALETTE_TOTAL;
  for (const [r, g, b, weight] of STAR_PALETTE) {
    roll -= weight;
    if (roll <= 0) return `${r}, ${g}, ${b}`;
  }
  const [r, g, b] = STAR_PALETTE[STAR_PALETTE.length - 1];
  return `${r}, ${g}, ${b}`;
}

/** One parallax layer of stars as a single element's box-shadow list. Thousands
 * of DOM nodes would be the obvious way and the wrong one; this paints the whole
 * layer from one node, which is what makes three drifting layers cheap. */
function starLayer(seed: number, count: number, spread: number, maxSize: number): string {
  const rand = mulberry32(seed);
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const x = (rand() * spread).toFixed(0);
    const y = (rand() * spread).toFixed(0);
    const size = (0.5 + rand() * maxSize).toFixed(2);
    const alpha = (0.28 + rand() * 0.72).toFixed(2);
    const color = pickStarColor(rand);
    parts.push(`${x}px ${y}px 0 ${size}px rgba(${color}, ${alpha})`);
  }
  return parts.join(",");
}

/** The stars that actually twinkle. The three box-shadow layers above paint one
 * field each from a single node, which is what makes them cheap — but it also
 * means they can only be animated as a whole, and a sky where every star pulses
 * on the same beat reads as a flashing screen, not as stars. These are real
 * elements, few enough to be free, each on its own period and phase. */
interface Twinkler {
  x: number;
  y: number;
  size: number;
  dur: number;
  delay: number;
  peak: number;
  flare: boolean;
  /** "r, g, b" — see STAR_PALETTE/pickStarColor. */
  color: string;
}

function twinkleField(seed: number, count: number): Twinkler[] {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, () => {
    const size = 1 + rand() * 2.1;
    return {
      x: rand() * 100,
      y: rand() * 100,
      size,
      // A wide spread of periods is what stops the field finding a common beat.
      dur: 2.6 + rand() * 6.4,
      delay: -rand() * 9,
      peak: 0.5 + rand() * 0.5,
      // Only the biggest few get diffraction spikes, as in a real exposure.
      flare: size > 2.7,
      color: pickStarColor(rand),
    };
  });
}

/* ───────────────────────────── clocks ───────────────────────────── */

/** Seoul and New York, side by side — the two sessions this site actually
 * covers. Pinned to those zones rather than the visitor's own: they label
 * exchange hours, so a reader abroad needs the exchange's clock, not theirs. */
function useTick(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function ClockRow({ flag, code, zone, now }: { flag: string; code: string; zone: string; now: Date }) {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  return (
    <div className="hb-clock-row">
      <img className="hb-clock-flag" src={`/img/flag/${flag}.svg`} alt="" loading="lazy" />
      <span className="hb-clock-code">{code}</span>
      <span className="hb-clock-time">{time}</span>
    </div>
  );
}

function HubClocks() {
  const now = useTick();
  return (
    <div className="hb-clocks" aria-hidden="true">
      <ClockRow flag="kr" code="SEO" zone="Asia/Seoul" now={now} />
      <ClockRow flag="us" code="NYC" zone="America/New_York" now={now} />
    </div>
  );
}

/* ───────────────────────────── helpers ───────────────────────────── */

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function toneOf(value: number | null | undefined): "up" | "down" | "flat" {
  if (value === null || value === undefined) return "flat";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

/* ───────────────────────────── moons ─────────────────────────────
   Small satellites orbiting a specific planet rather than the sun. They sit
   inside that planet's own `.hb-billboard` (see Planet below), which is
   already the flattened, camera-facing frame the planet's own face uses — a
   plain 2D rotate here is enough to sweep them around the disc; there is no
   tilt left to cancel at that point in the transform chain.

   Three kinds:
   - "stock": Earth's Samsung/SK hynix satellites — real logos (the existing
     StockIcon component, same Naver-backed source every other logo in this
     app uses), clicking through to that company's actual stock page (see
     App.tsx: any "open a stock" route now targets /dashboard?code=).
   - "rocket": Mars's satellite. There's no stock page to link to (SpaceX
     isn't listed on any exchange this app tracks), and — unlike the Samsung/
     SK logos above, which identify real tickers this app actually covers —
     stamping SpaceX's actual trademarked wordmark on a decorative orbiter
     isn't the same kind of use. This reuses CelestialBody's RocketCraft (the
     same generic vector built for the earlier, now-removed Earth→Mars
     flourish) as a stand-in, and links to /global?code=SPCX (GlobalStockPage,
     which reads ?code= itself) per an explicit request for that destination.
   - "lunar": Earth's other satellite — the actual Moon, orbiting further out
     than the two stock badges. No text/tooltip by design (an explicit
     request: unlike the other two kinds, nothing is written on or over it),
     just an aria-label for screen readers; clicking it opens the same /map
     KOSPI destination Earth itself does. */

interface MoonSpec {
  key: string;
  to: string;
  ko: string;
  en: string;
  /** For stock moons: added to the host planet's own rendered radius, in px,
   * so the orbit always clears the planet regardless of viewport scale (both
   * are in the same --size / --body-unit units via the CSS calc in
   * .hb-moon-arm). For the rocket: subtracted instead, pulling its landed
   * position down past the planet's edge so the engine actually reaches the
   * surface — see .hb-mars-rocket-arm in hub.css. Unused for "lunar" — that
   * orbit's gap is fixed in size units directly in .hb-earth-moon-arm
   * instead, since the Moon's own box scales with Earth's size/--body-unit
   * rather than being a flat px badge like the other two kinds, and a flat
   * px gap next to a scaling body would drift out of proportion at the
   * extremes (see the rocket's own --mr-extra fix for exactly this class of
   * bug). */
  offsetPx: number;
  /** Orbit period for stock moons and the Moon; full liftoff→hover→landing
   * cycle length for the rocket. */
  durationSeconds: number;
  phase: number;
  kind: "stock" | "rocket" | "lunar";
  /** Stock code for StockIcon — only set when kind is "stock". */
  code?: string;
}

// Real texture (same Solar System Scope CC BY 4.0 source/pipeline as the
// planets — see /img/planets/) rather than a procedural body: an earlier,
// drawn version was replaced per an explicit request for a real photo here
// too. spinSeconds is well under Earth's 11s — visibly faster, matching a
// separate explicit request — rather than the Moon's real ~27-day tidally
// locked rotation, which read as motionless like Mercury's would.
const MOON_SKIN: PhotoSkin = {
  texture: "/img/planets/moon.webp",
  spinSeconds: 6,
  glow: "#cfc9be",
};

const EARTH_MOONS: MoonSpec[] = [
  { key: "samsung", to: "/dashboard?code=005930", ko: "삼성전자", en: "Samsung", offsetPx: 7, durationSeconds: 7, phase: 0, kind: "stock", code: "005930" },
  { key: "skhynix", to: "/dashboard?code=000660", ko: "SK하이닉스", en: "SK hynix", offsetPx: 12, durationSeconds: 11, phase: 0.5, kind: "stock", code: "000660" },
  // Slower than the two badges, and a tight orbit hugging Earth's own edge
  // (see .hb-earth-moon-arm in hub.css) — the real Moon should read as a
  // heavier, more deliberate body than a couple of quick tech-logo satellites.
  // phase 0 starts it level with Earth's own centre (the ellipse's rightmost
  // point) rather than at the top, which is where an earlier phase (0.75)
  // happened to place it.
  { key: "moon", to: "/map", ko: "달", en: "Moon", offsetPx: 0, durationSeconds: 24, phase: 0, kind: "lunar" },
];

// "/global?code=SPCX" rather than the full production URL — GlobalStockPage
// (App.tsx's "/global" route) already reads ?code= itself, and a relative
// path keeps this working through the SPA's own navigate() in local dev too;
// a hardcoded https://kospi-predictor.onrender.com/... would send local
// testing off to the live site instead of whatever's actually running here.
const MARS_MOONS: MoonSpec[] = [
  { key: "spacex", to: "/global?code=SPCX", ko: "SpaceX", en: "SpaceX", offsetPx: 14, durationSeconds: 9, phase: 0.25, kind: "rocket" },
];

function Moonlet({ spec, en, onOpen }: { spec: MoonSpec; en: boolean; onOpen: (to: string) => void }) {
  const label = en ? spec.en : spec.ko;
  const delay = `${-spec.durationSeconds * spec.phase}s`;
  const style = {
    "--md": `${spec.durationSeconds}s`,
    "--mdelay": delay,
    "--mr": `${spec.offsetPx}px`,
  } as React.CSSProperties;

  // The rocket doesn't orbit like the stock-badge moons — it parks at Mars's
  // north pole and cycles between sitting there and lifting straight up off
  // it, so it gets its own (non-rotating) positioning chain. See the
  // `.hb-mars-rocket-*` rules in hub.css for the actual liftoff/landing
  // keyframes.
  if (spec.kind === "rocket") {
    return (
      <div className="hb-mars-rocket-orbiter" style={style}>
        <div className="hb-mars-rocket-arm">
          <div className="hb-mars-rocket-face">
            <button
              type="button"
              className="hb-moon hb-moon--rocket"
              onClick={() => onOpen(spec.to)}
              aria-label={`${en ? "Satellite" : "위성"}: ${label}`}
              title={label}
            >
              <RocketCraft />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // The Moon reuses the same circular-sweep rig the stock badges use below
  // (.hb-moon-orbiter/.hb-moon-face), just with its own arm and the
  // --equatorial modifiers, which flatten the sweep into an ellipse hugging
  // Earth's equator rather than a full circle reaching as far "over the
  // poles" as it does past the sides (an explicit request) — its orbit
  // radius is a fixed size-unit gap past Earth's actual edge rather than a
  // flat px one, so it scales with Earth instead of drifting out of
  // proportion at extreme viewport sizes (see offsetPx's comment above). No
  // `title` here, unlike the other two kinds — an explicit request that
  // nothing be written on this one; aria-label alone still names it for
  // screen readers.
  if (spec.kind === "lunar") {
    return (
      <div className="hb-moon-orbiter hb-moon-orbiter--equatorial" style={style}>
        {/* The depth swap sits on its own element — see .hb-moon-depth in
            hub.css, and .hb-orbit-spin for the same split on the planets. */}
        <div className="hb-moon-depth">
          <div className="hb-earth-moon-arm">
            <div className="hb-moon-face hb-moon-face--equatorial">
              <button
                type="button"
                className="hb-moon hb-moon--lunar"
                onClick={() => onOpen(spec.to)}
                aria-label={`${en ? "Satellite" : "위성"}: ${label}`}
              >
                <PhotoPlanetBody id="moon" skin={MOON_SKIN} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="hb-moon-orbiter" style={style}>
      <div className="hb-moon-arm">
        <div className="hb-moon-face">
          <button
            type="button"
            className="hb-moon"
            onClick={() => onOpen(spec.to)}
            aria-label={`${en ? "Satellite" : "위성"}: ${label}`}
            title={label}
          >
            <SatelliteCraft />
            <StockIcon code={spec.code!} className="hb-moon-logo" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── asteroid belt ─────────────────────────────
   A real feature, stylised: hundreds of tiny rocks scattered in a band
   strictly between Mars's and Jupiter's own orbit radii (355 and 440 design
   units — see PLANETS above), an explicit request. PC-only (see
   .hb-asteroid-belt in hub.css, which hides it below the same 640px
   breakpoint everything else here treats as "mobile") — which is also why
   each rock's position below skips the "+ --orbit-base" term .hb-ring's own
   radius formula carries: --orbit-base is 0 at every breakpoint wider than
   that (it only turns on for the mobile tiers this never renders at), so
   there is nothing for that term to add here. */

interface AsteroidRock {
  /** r * cos(angle) and r * sin(angle) — plain multipliers for
   * --orbit-unit, precomputed so each rock only needs one calc() multiply
   * rather than carrying its own radius/angle separately. */
  mx: number;
  my: number;
  size: number;
  /** "r, g, b" — see ASTEROID_PALETTE/pickAsteroidColor. */
  color: string;
}

/** Real asteroids read as rock, not gravel — mostly dark carbonaceous grey
 * (C-type, the actual majority composition in the belt), a lighter tan
 * minority (S-type), and only a rare warm metallic glint (M-type), rather
 * than an even, confetti-like split. Same weighted-roll approach as
 * STAR_PALETTE/pickStarColor above. */
const ASTEROID_PALETTE: [number, number, number, number][] = [
  [110, 103, 96, 0.55],
  [80, 75, 71, 0.22],
  [168, 154, 134, 0.18],
  [190, 152, 108, 0.05],
];
const ASTEROID_PALETTE_TOTAL = ASTEROID_PALETTE.reduce((sum, [, , , w]) => sum + w, 0);

function pickAsteroidColor(rand: () => number): string {
  let roll = rand() * ASTEROID_PALETTE_TOTAL;
  for (const [r, g, b, weight] of ASTEROID_PALETTE) {
    roll -= weight;
    if (roll <= 0) return `${r}, ${g}, ${b}`;
  }
  const [r, g, b] = ASTEROID_PALETTE[ASTEROID_PALETTE.length - 1];
  return `${r}, ${g}, ${b}`;
}

/** innerR/outerR are already inset a margin in from Mars's 355 and Jupiter's
 * 440 (see the call site), so the belt never touches either ring — the
 * explicit "must stay strictly between them" request, with room to spare
 * rather than landing right at the boundary. */
function asteroidBelt(seed: number, count: number, innerR: number, outerR: number): AsteroidRock[] {
  const rand = mulberry32(seed);
  const rocks: AsteroidRock[] = [];
  for (let i = 0; i < count; i += 1) {
    const r = innerR + rand() * (outerR - innerR);
    const angle = rand() * Math.PI * 2;
    rocks.push({
      mx: r * Math.cos(angle),
      my: r * Math.sin(angle),
      size: 1.5 + rand() * 1.5,
      color: pickAsteroidColor(rand),
    });
  }
  return rocks;
}

/* ───────────────────────────── planet ───────────────────────────── */

function Planet({
  spec,
  change,
  en,
  onOpen,
}: {
  spec: PlanetSpec;
  change: number | null;
  en: boolean;
  onOpen: (to: string) => void;
}) {
  const label = en ? spec.en : spec.ko;
  // Negative delay starts the animation partway through its cycle, which is what
  // places each planet at its own angle on a shared ring. The billboard below
  // runs the inverse rotation on the same duration and the same delay, so it
  // cancels the ring's spin exactly and the face never tips away from the camera.
  const delay = `${-spec.duration * spec.phase}s`;

  const style = {
    "--r": String(spec.radius),
    "--d": `${spec.duration}s`,
    "--delay": delay,
    "--size": String(spec.size),
    "--glow": spec.skin.glow,
    // The rendered photo disc only fills this fraction of the button's own
    // box (PhotoPlanetBody draws it at (discR*2)/100 of the box — the rest is
    // transparent atmosphere margin around it). The Mars rocket needs this to
    // land on the planet's actual visible edge rather than the invisible
    // edge of the full box; see .hb-mars-rocket-arm in hub.css.
    "--disc-pct": String(((spec.skin.discR ?? BASE_R) * 2) / 100),
  } as React.CSSProperties;

  return (
    /* Two nested elements rather than one carrying both animations — see
       .hb-orbiter/.hb-orbit-spin in hub.css. The revolution has to sit on an
       element whose animations are ALL compositable, and the z-index swap
       that stands in for depth sorting is not one. */
    <div className="hb-orbiter" style={style}>
      <div className="hb-orbit-spin">
        <div className="hb-arm">
          <div className="hb-billboard">
          <button
            type="button"
            className="hb-planet"
            onClick={() => onOpen(spec.to)}
            aria-label={`${en ? "Planet" : "행성"}: ${label}`}
          >
            <PhotoPlanetBody id={spec.key} skin={spec.skin} />
            <span className="hb-tag">
              <span className="hb-tag-name">{label}</span>
              {change !== null && (
                <span className={`hb-tag-move is-${toneOf(change)}`}>{pct(change)}</span>
              )}
            </span>
          </button>
            {(spec.key === "earth" || spec.key === "mars") && (
              <div className="hb-moons">
                {(spec.key === "earth" ? EARTH_MOONS : MARS_MOONS).map((moon) => (
                  <Moonlet key={moon.key} spec={moon} en={en} onOpen={onOpen} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── neutron binary ─────────────────────────────
   Two equal-size neutron stars in the upper-right sky, mutually orbiting a
   shared centre along a single horizontal line — an edge-on, "facing each
   other, side to side" view, not a full circular sweep — rather than one
   orbiting the other, per an explicit request. Driven by rAF instead of CSS
   keyframes: the orbital period, the separation between the two stars, and
   the glow all have to move together (closer = faster = brighter, also per
   an explicit request), which is a small time-stepped loop here and would
   need dozens of hand-timed keyframe stops to fake in pure CSS.

   The cycle ends in an actual merger: after the last lap the two stars
   plunge together, and the instant they touch, useNeutronBinary fires two
   things at once (see fireMergerBurst below) — .hb-neutron-flash, the
   sub-second white gamma-ray-burst flash, and .hb-supernova, a thirty-second
   expanding ejecta cloud that takes over from it and does the actual work.
   They sit merged for those same thirty seconds, and the cloud has faded to
   nothing by the moment the remnant splits back apart, so every cycle starts
   from a clean sky. */

/** How separated (amp, in --body-unit units — see .hb-neutron-binary in
 * hub.css) and how bright (glow, a filter: brightness() multiplier) the
 * pair is at a given orbital period. Keyed by the exact period values
 * NEUTRON_STAGES uses below.
 *
 * The pair opens at twice the separation it used to (44, was 22), per an
 * explicit request that the two stars start about twice as far from each
 * other. The stages in between were re-spaced along with it rather than left
 * where they were: widening only the first anchor would have held the pair at
 * 44 for the whole 10-second opening stage and then hauled it in to 19 in
 * about a second at the first boundary, which the eye reads as the animation
 * glitching, not as a wider start — the exact snap the easing in the orbit
 * branch below exists to avoid. So the ramp is even (~6-7 units a stage) from
 * the new opening down to the same final 5 it always ended on. Everything past
 * that last stage — the plunge, the flash, the 30s hold — is untouched, since
 * the merger starts from that unchanged 5. */
const NEUTRON_ANCHORS: Record<string, { amp: number; glow: number }> = {
  "5": { amp: 44, glow: 1.0 },
  "4": { amp: 37, glow: 1.1 },
  "3": { amp: 31, glow: 1.25 },
  "2": { amp: 24, glow: 1.4 },
  "1": { amp: 18, glow: 1.6 },
  "0.5": { amp: 11, glow: 1.8 },
  "0.2": { amp: 5, glow: 2.0 },
};

interface NeutronStage {
  /** Orbital period in seconds — looked up in NEUTRON_ANCHORS. */
  period: number;
  /** How many full laps to run at that period before moving to the next
   * stage — this is what makes 20 laps land exactly on the final 0.2s
   * stage (2+2+2+2+2+4+6), per an explicit request. */
  laps: number;
}

/* The inspiral: the period shortens 5s -> 4s -> 3s -> 2s -> 1s -> 0.5s ->
 * 0.2s, 20 laps total, closing in as it speeds up — the exact sequence and
 * lap count from an explicit request. useNeutronBinary below runs this
 * once per cycle and then hands off to the merge/flash/hold sequence,
 * rather than looping this array directly — there is no "drifting back
 * apart" stage any more; the pair now merges instead (see MERGE_* below). */
const NEUTRON_STAGES: NeutronStage[] = [
  { period: 5, laps: 2 },
  { period: 4, laps: 2 },
  { period: 3, laps: 2 },
  { period: 2, laps: 2 },
  { period: 1, laps: 2 },
  { period: 0.5, laps: 4 },
  { period: 0.2, laps: 6 },
];

/** Seconds to plunge from the last stage's separation down to 0 once all
 * 20 laps are done — fast enough to read as a final infall, not another
 * orbital stage. */
const NEUTRON_MERGE_DURATION = 0.45;
/** Brightness/scale the merged single body holds at, both eased toward
 * over the plunge and held through NEUTRON_HOLD_DURATION. The scale is
 * literally 2 — twice one star's own size, per an explicit request — and it
 * applies to the two stars themselves as they converge, which is what makes
 * the handover to the merged body below read as one thing swelling rather
 * than as a swap between two different objects. */
const NEUTRON_MERGE_GLOW = 2.6;
const NEUTRON_MERGE_SCALE = 2;
/** Seconds the merged body is held before it splits back apart and the next
 * inspiral begins — per an explicit request (was 10, and 2 before that). This
 * number and the supernova's own animation length are the same thirty
 * seconds on purpose: the ejecta cloud is authored to fade out on its last
 * keyframe, so the sky is empty again at the exact moment the remnant splits
 * and the next inspiral starts, per an explicit request that everything be
 * back to its original state after thirty seconds. Anything that changes
 * here has to change with the 30s animation durations in hub.css's
 * "supernova ejecta" section too — and with buildEjectaKnots' own per-knot
 * durations below, which are all authored to finish inside that window. */
const NEUTRON_HOLD_DURATION = 30;

/** Restarts the merger's two burst animations — the sub-second white flash
 * and the thirty-second ejecta cloud that takes over from it. remove+reflow+
 * add rather than just add, since the classes may already be present (holding
 * their post-animation resting state) from a previous merge and a bare add()
 * wouldn't retrigger a CSS animation in that case.
 *
 * Both are restarted from this one call so they share an origin instant: the
 * cloud's first keyframes are authored to emerge from underneath the flash
 * while it is still washing the screen out, which only reads as one event if
 * neither can start a frame ahead of the other. */
function fireMergerBurst(
  flashRef: React.RefObject<HTMLDivElement>,
  novaRef: React.RefObject<HTMLDivElement>
) {
  const flash = flashRef.current;
  if (flash) {
    flash.classList.remove("is-flashing");
    void flash.offsetWidth;
    flash.classList.add("is-flashing");
  }
  const nova = novaRef.current;
  if (nova) {
    nova.classList.remove("is-bursting");
    void nova.offsetWidth;
    nova.classList.add("is-bursting");
  }
}

function useNeutronBinary(
  ref: React.RefObject<HTMLButtonElement>,
  flashRef: React.RefObject<HTMLDivElement>,
  novaRef: React.RefObject<HTMLDivElement>
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Static resting frame instead (see .hb-neutron-binary's reduced-motion
    // rule in hub.css) — no rAF loop, and the flash never fires.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let last = performance.now();
    let mode: "orbit" | "merge" | "hold" = "orbit";
    let stageIndex = 0;
    let stageElapsed = 0;
    let mergeElapsed = 0;
    let holdElapsed = 0;
    let ampAtMergeStart = 0;
    let phase = 0;
    const first = NEUTRON_ANCHORS[String(NEUTRON_STAGES[0].period)];
    let amp = first.amp;
    let glow = first.glow;
    let mscale = 1;
    // 0 while the pair is still two stars, 1 once they are one body — the
    // crossfade between the orbiting pair and the merged remnant (see
    // .hb-neutron-merged in hub.css). Eased rather than switched, so the
    // handover happens across the plunge instead of popping at the instant
    // the separation reaches zero.
    let merged = 0;
    // Last values actually written out — see the write-gating at the end of
    // tick(). Seeded to -Infinity rather than NaN so the first frame's
    // difference check is unambiguously "far enough" and both get written
    // once up front (any comparison against NaN is false, which would have
    // suppressed the initial write entirely instead of forcing it).
    let lastGlow = Number.NEGATIVE_INFINITY;
    let lastMscale = Number.NEGATIVE_INFINITY;
    let lastMerged = Number.NEGATIVE_INFINITY;

    const tick = (now: number) => {
      // Capped so a background/throttled tab doesn't dump one huge dt on
      // return and skip whole stages (or the entire merge) in one frame.
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      if (mode === "orbit") {
        stageElapsed += dt;
        let stage = NEUTRON_STAGES[stageIndex];
        let stageDuration = stage.period * stage.laps;
        while (stageElapsed >= stageDuration) {
          stageElapsed -= stageDuration;
          stageIndex += 1;
          if (stageIndex >= NEUTRON_STAGES.length) {
            // All 20 laps done — hand off to the plunge/merge below instead
            // of wrapping back to stage 0 directly.
            mode = "merge";
            mergeElapsed = 0;
            ampAtMergeStart = amp;
            break;
          }
          stage = NEUTRON_STAGES[stageIndex];
          stageDuration = stage.period * stage.laps;
        }
        if (mode === "orbit") {
          // Eased toward the new stage's separation/glow rather than
          // snapped, so a stage boundary reads as the pair drifting
          // closer rather than teleporting. The angular speed itself
          // still changes instantly at the boundary — that discontinuity
          // is the actual "speeds up" effect that was asked for.
          const target = NEUTRON_ANCHORS[String(stage.period)];
          const ease = 1 - Math.exp(-dt / 0.35);
          amp += (target.amp - amp) * ease;
          glow += (target.glow - glow) * ease;
          mscale += (1 - mscale) * ease;
          merged += (0 - merged) * ease;
          phase += ((2 * Math.PI) / stage.period) * dt;
        }
      }

      if (mode === "merge") {
        mergeElapsed += dt;
        const t = Math.min(mergeElapsed / NEUTRON_MERGE_DURATION, 1);
        const eased = t * t * (3 - 2 * t); // smoothstep — accelerating infall
        amp = ampAtMergeStart * (1 - eased);
        glow += (NEUTRON_MERGE_GLOW - glow) * (1 - Math.exp(-dt / 0.15));
        mscale += (NEUTRON_MERGE_SCALE - mscale) * (1 - Math.exp(-dt / 0.2));
        // Slower than the plunge itself, so the two stars are already on top
        // of each other and swollen before the merged body has fully taken
        // over from them — the pair reads as becoming the remnant rather than
        // being replaced by it.
        merged += (1 - merged) * (1 - Math.exp(-dt / 0.18));
        // Keep spinning at the fastest rate right through the final plunge.
        phase += ((2 * Math.PI) / 0.2) * dt;
        if (t >= 1) {
          amp = 0;
          mode = "hold";
          holdElapsed = 0;
          fireMergerBurst(flashRef, novaRef);
        }
      } else if (mode === "hold") {
        holdElapsed += dt;
        amp = 0;
        glow += (NEUTRON_MERGE_GLOW - glow) * (1 - Math.exp(-dt / 0.3));
        merged += (1 - merged) * (1 - Math.exp(-dt / 0.3));
        if (holdElapsed >= NEUTRON_HOLD_DURATION) {
          // Back to stage 0 — amp/glow/mscale ease back out toward the
          // wide/dim/normal-size resting values on their own from here,
          // via the same easing the "orbit" branch above already does.
          mode = "orbit";
          stageIndex = 0;
          stageElapsed = 0;
        }
      }

      // --nx genuinely has to be written every frame: the pair is in motion
      // for the entire cycle. --glow and --mscale are not — both ease toward
      // a target that only moves at a stage boundary or at the merge, so they
      // sit effectively still for seconds at a time. Setting a custom property
      // invalidates style for everything that reads it whether or not the
      // value actually changed, so these two are held until they've drifted
      // far enough to be worth a repaint. Two decimal places on --nx for the
      // same reason: the third was sub-pixel at any viewport this renders at.
      const nx = amp * Math.cos(phase);
      el.style.setProperty("--nx", nx.toFixed(2));
      if (Math.abs(glow - lastGlow) >= 0.005) {
        lastGlow = glow;
        el.style.setProperty("--glow", glow.toFixed(3));
      }
      if (Math.abs(mscale - lastMscale) >= 0.005) {
        lastMscale = mscale;
        el.style.setProperty("--mscale", mscale.toFixed(3));
      }
      if (Math.abs(merged - lastMerged) >= 0.005) {
        lastMerged = merged;
        el.style.setProperty("--merged", merged.toFixed(3));
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ref, flashRef, novaRef]);
}

/* ─────────────────────────── supernova ejecta ───────────────────────────
   What the merger throws off, and the reason the white flash is now only the
   first half-second of the event rather than the whole of it.

   Built from what a real remnant actually looks like rather than from the
   cartoon "orange fireball": Cassiopeia A, the Crab and Tycho are all a
   HOLLOW, lumpy shell, not a filled ball — a fast blue-white shock front
   running ahead (the shocked, doubly-ionised oxygen that gives Tycho and the
   Crab their blue), a thick churning body of red and orange behind it
   (sulphur and hydrogen filaments, the dominant colour in every one of these
   photographs), gold and white where the material is hottest and closest in,
   and the whole thing threaded with radial filaments and studded with
   discrete knots of ejecta flying out at their own speeds and their own
   angles. Nothing about a real one is symmetric, and that asymmetry is most
   of what makes the image read as an explosion rather than as a ring.

   The shells and filaments are CSS (see .hb-supernova in hub.css — layered
   radial and conic gradients, animated on transform and opacity only, so a
   full-screen effect running for thirty seconds costs the compositor and not
   the painter). These knots are the asymmetry: each one is thrown on its own
   heading at its own speed, deterministically, so the remnant has clumps and
   gaps in it instead of expanding as a clean disc. */

/** Emission colours, as bare `r, g, b` triples for the gradients in hub.css
 * to wrap in their own alphas. Ordered hottest-to-coolest, which is also
 * fastest-to-slowest: the blue end is the leading shock, the red end is the
 * bulk of the ejecta trailing behind it. */
const EJECTA_TINTS = [
  "255, 246, 224",
  "255, 214, 122",
  "255, 158, 54",
  "255, 96, 44",
  "236, 48, 62",
  "236, 74, 168",
  "120, 196, 255",
  "88, 132, 255",
];

interface EjectaKnot {
  /** Heading, in degrees. */
  angle: number;
  /** How far out it gets by the end of its own flight, in vmax — the fastest
   * ones leave the frame entirely, which is what they should do. */
  distance: number;
  /** Diameter at launch, in vmax. */
  size: number;
  tint: string;
  /** Seconds into the 30s life it is thrown, and how long its flight runs. */
  delay: number;
  duration: number;
  /** How much it spreads out as it goes — a clump of gas dissipates as it
   * expands, so it ends much larger and much fainter than it started. */
  grow: number;
}

/** Deterministic, same reasoning as the starfield and the black hole's disc:
 * a remnant that reshuffled its own clumps on every mount would read as the
 * explosion changing shape rather than as one fixed object. */
function buildEjectaKnots(count: number, seed: number): EjectaKnot[] {
  const rand = mulberry32(seed);
  const knots: EjectaKnot[] = [];
  for (let i = 0; i < count; i += 1) {
    // Evenly spaced headings with a wide random wobble on top, rather than
    // fully random angles: pure randomness clusters, and a clump of clumps
    // all on one side reads as a mistake rather than as asymmetry. This
    // covers every direction — "사방으로", in all directions — while still
    // being visibly uneven.
    const angle = (360 / count) * i + (rand() - 0.5) * (300 / count);
    // Hot fast material leads, cool slow material trails: the tint index is
    // taken from the same roll that sets the speed, so the blue-white knots
    // are the ones out in front and the deep red ones lag behind, the way the
    // colour is layered in a real remnant.
    const speed = rand();
    const tintIndex = Math.min(
      EJECTA_TINTS.length - 1,
      Math.floor((1 - speed) * 0.55 * EJECTA_TINTS.length + (rand() < 0.22 ? 5 : 0))
    );
    knots.push({
      angle,
      distance: 34 + speed * 78,
      size: 5 + rand() * 13,
      tint: EJECTA_TINTS[tintIndex],
      // Delay plus duration has to stay under the thirty seconds the merged
      // remnant is held for (NEUTRON_HOLD_DURATION above): 3.4 + 25 leaves
      // the slowest, latest-thrown clump a second and a half of margin, so
      // every knot has finished fading before the pair splits back apart and
      // none of them is still on screen when the sky is supposed to be clear.
      delay: 0.3 + rand() * 3.1,
      duration: 14 + (1 - speed) * 11,
      grow: 2.4 + rand() * 3.4,
    });
  }
  return knots;
}

const EJECTA_KNOTS = buildEjectaKnots(20, 60217);

/* ───────────────────────────── pluto event ─────────────────────────────
   A standing vignette next to the black hole, independent of the solar
   system proper: Mars-sized Pluto drifts in from the hole's left (centre to
   centre) at a literal 20px/s, starts tearing apart once that distance
   reaches 150px, and is fully torn into 96 pieces and pulled in within a
   fixed 3 seconds of that — the hole itself flaring red for two seconds —
   before the whole thing resets and repeats, per an explicit request laying
   out each of those numbers and the black hole's own reaction. Every
   distance below is real screen pixels (not the --body-unit design units
   the rest of the system scales with), which is what the request specified
   and also just makes sense for something anchored to a fixed-position
   corner button rather than the tilted, responsively-scaled orbital plane.

   Timed the same way useNeutronBinary above is: one rAF loop, no CSS
   keyframes, because position, tear damage, the debris field and the black
   hole's own flare all have to read one shared clock rather than run on
   independent timers that could drift apart from each other. */

const PLUTO_SKIN: PhotoSkin = {
  texture: "/img/planets/pluto.webp",
  spinSeconds: 17,
  glow: "#d9b48f",
};

// --pluto-gap is the live distance from the black hole's own CENTRE to
// Pluto's centre, px (not its right edge — see .hb-pluto-event in hub.css,
// which adds the (--bh-size - --pluto-size) / 2 term to translate "distance
// between centres" into a right-edge CSS offset). All per an explicit
// request pinning the approach distance to the hole's centre specifically.
const PLUTO_START_GAP = 300;
const PLUTO_SPEED = 15; // px/s, approach only — see the piecewise gap(t) in usePlutoEvent
const PLUTO_TEAR_GAP = 150; // destruction begins once the approach reaches this

// Once destruction starts it's timed by a fixed total duration rather than
// by more distance thresholds — "모두 3초 내에 돌조각으로 파괴되어... 빨려들어가게"
// (all of it torn into rock and pulled in within 3 seconds), an explicit
// request. Split tear:swirl roughly 4:3, the same ratio an earlier
// distance-based version of this used, rather than an even half-half.
const PLUTO_FLASH_HOLD = 2; // seconds — matches .hb-blackhole.is-feeding's hold
const PLUTO_DESTROY_DURATION = 3;
const PLUTO_TEAR_LEN = PLUTO_DESTROY_DURATION * (4 / 7); // ~1.71s
const PLUTO_SWIRL_LEN = PLUTO_DESTROY_DURATION - PLUTO_TEAR_LEN; // ~1.29s

const PLUTO_TEAR_START = (PLUTO_START_GAP - PLUTO_TEAR_GAP) / PLUTO_SPEED; // 10s
const PLUTO_SWIRL_START = PLUTO_TEAR_START + PLUTO_TEAR_LEN;
const PLUTO_MOTION = PLUTO_TEAR_START + PLUTO_DESTROY_DURATION; // gap hits 0 here
// Padded ~1s past PLUTO_MOTION — comfortably past the latest a dust mote's
// own life can run on (activates as late as ~0.28s before MOTION, up to
// 0.9s life, so ~0.62s past it at the extreme) — so the destroy-window
// gate below never cuts off a fragment's own fade-out mid-flight.
const PLUTO_DESTROY_TAIL_END = PLUTO_MOTION + 1;
const PLUTO_CYCLE = PLUTO_MOTION + PLUTO_FLASH_HOLD; // then it repeats

/** One vertical "tooth" of the erosion clip-path — see plutoErosionClip.
 * Bands are even (yStart/yEnd just slice the disc into 12 equal strips);
 * only each tooth's own stagger is randomised, which is what keeps the
 * torn edge from eroding as one clean vertical line. */
interface PlutoTooth {
  yStart: number;
  yEnd: number;
  stagger: number;
}

const PLUTO_TEETH: PlutoTooth[] = (() => {
  const n = 12;
  const rand = mulberry32(20260728);
  return Array.from({ length: n }, (_, i) => ({
    yStart: i / n,
    yEnd: (i + 1) / n,
    stagger: rand() * 0.4,
  }));
})();

/** How far each tooth erodes at full tear progress — 1 would eat the whole
 * disc, same as an earlier version of this did. Capped short of that now:
 * the surviving sliver past this point is what PLUTO_STRETCH_MAX/SQUASH_MAX
 * below stretch into the spaghettified thread, so there has to still be a
 * "core" left for that transform to act on rather than the clip alone
 * already having erased everything by the time the stretch matters. */
const PLUTO_EROSION_MAX = 0.62;

/** The erosion clip as a CSS `polygon()`, in percentages of the element's own
 * box. p1 is tear progress, 0 (intact) to 1 (fully eroded up to
 * PLUTO_EROSION_MAX) — see PLUTO_TEAR_*. Each tooth erodes from the right
 * edge (x=100%) toward the left on its own delayed/eased schedule, so the
 * boundary reads as a ragged tear line sweeping across the disc rather than a
 * straight wipe.
 *
 * This was an SVG `<clipPath>` — a real `<polygon>` element in the document
 * whose `points` attribute was rewritten every frame, referenced from CSS as
 * `clip-path: url(#hb-pluto-erosion)`. The note on `.hb-pluto-body.is-tearing`
 * in hub.css already recorded that Safari/iPadOS drops an element carrying an
 * SVG clip-path off its accelerated path and repaints it in software whenever
 * anything inside moves — which, with Pluto's texture spinning throughout,
 * was every frame of the tear. That note's fix was to scope the clip to the
 * destroy window; this is the rest of it. A CSS `polygon()` is a geometry the
 * compositor understands directly, with no document reference to resolve and
 * no second element to mutate. */
function plutoErosionClip(p1: number): string {
  const pts: string[] = ["0% 0%"];
  for (const tooth of PLUTO_TEETH) {
    const local = Math.min(1, Math.max(0, (p1 - tooth.stagger) / (1 - tooth.stagger)));
    const eased = local * local * (3 - 2 * local);
    const x = ((1 - eased * PLUTO_EROSION_MAX) * 100).toFixed(2);
    pts.push(`${x}% ${(tooth.yStart * 100).toFixed(2)}%`);
    pts.push(`${x}% ${(tooth.yEnd * 100).toFixed(2)}%`);
  }
  pts.push("0% 100%");
  return `polygon(${pts.join(", ")})`;
}

/** Spaghettification — the real astrophysical term for exactly this, a body
 * stretched radially and squeezed tangentially by a black hole's tidal
 * gradient — applied to whatever the erosion clip above hasn't already torn
 * off. PLUTO_STRETCH_MAX is added to scaleX and PLUTO_SQUASH_MAX subtracted
 * from scaleY, both scaled by p1, so intact (p1=0) is a plain 1/1 and full
 * tear progress (p1=1) is a long, thin thread — 4.2x its own width, 18% of
 * its own height. Applied with `transform-origin: 0% 50%` (see
 * .hb-pluto-body in hub.css) so the stretch reaches out to the right, into
 * the black hole, rather than growing symmetrically from the centre. */
const PLUTO_STRETCH_MAX = 3.2;
const PLUTO_SQUASH_MAX = 0.82;

interface PlutoFragment {
  kind: "chunk" | "dust";
  /** 0..1 progress through this fragment's own phase (tear for chunks,
   * swirl for dust) at which it activates — staggered across the pool so
   * the tear/swirl reads as continuous shedding, not one synchronised pop. */
  activateAt: number;
  /** Seconds this fragment's own flight takes once activated. */
  life: number;
  /** Rendered size, px. */
  size: number;
  /** Degrees around Pluto's east-facing hemisphere (0 = pointing straight
   * at the black hole) a chunk breaks off from. Chunks only. */
  angleDeg: number;
  /** How far a chunk first flings outward — tidal sling — before its path
   * curves in toward the hole, px. Chunks only. */
  fling: number;
  /** Degrees/second tumble as a chunk flies in. Chunks only. */
  spin: number;
  /** Starting radius a dust mote spirals in from, as a fraction of Pluto's
   * own on-screen radius at the moment it activates. Dust only. */
  startR: number;
  /** Radians of extra winding a dust mote completes before reaching the
   * hole's centre — the "water down a drain" accelerating spiral. Dust
   * only. */
  turns: number;
  /** Starting angle, radians, for a dust mote's spiral. Dust only. */
  startTheta: number;
}

// 40 pieces total (20 rock chunks + 20 dust motes) — pulled back down from
// a 212-piece pass (180 chunks + 32 dust) that visibly dropped frames: each
// fragment costs real per-frame trig plus a style write, and 212 of those
// every tick was more than the page could sustain smoothly. Fewer, individually
// bigger/longer-lived pieces (see the size/life bumps below) is what keeps this
// still reading as "breaking apart" rather than a handful of specks, at a
// frame rate that's actually fluid instead of stepping.
const PLUTO_FRAGMENTS: PlutoFragment[] = (() => {
  const rand = mulberry32(31337);
  const list: PlutoFragment[] = [];
  const CHUNKS = 20;
  for (let i = 0; i < CHUNKS; i += 1) {
    list.push({
      kind: "chunk",
      activateAt: Math.min(1, (i / CHUNKS) * 0.85 + rand() * 0.18),
      life: 0.55 + rand() * 0.6,
      size: 5 + rand() * 9,
      angleDeg: -75 + rand() * 150,
      fling: 12 + rand() * 22,
      spin: (rand() < 0.5 ? -1 : 1) * (140 + rand() * 320),
      startR: 0,
      turns: 0,
      startTheta: 0,
    });
  }
  const DUST = 20;
  for (let i = 0; i < DUST; i += 1) {
    list.push({
      kind: "dust",
      activateAt: Math.min(1, (i / DUST) * 0.6 + rand() * 0.18),
      life: 0.45 + rand() * 0.45,
      size: 2.5 + rand() * 3,
      angleDeg: 0,
      fling: 0,
      spin: 0,
      startR: 0.35 + rand() * 0.55,
      turns: 2.2 + rand() * 2.4,
      startTheta: rand() * Math.PI * 2,
    });
  }
  return list;
})();

/* Every other piece, for the lite tier (see useSceneTier). Taken by
 * stride rather than by slicing the head of the list: the array is 20 chunks
 * followed by 20 dust motes, so a slice would have thrown away one of the two
 * phases entirely instead of thinning both. Each surviving fragment is a
 * composited layer carrying its own glow that gets a transform and an opacity
 * written to it on every frame it is alive, and they are all alive at once
 * during the three seconds this whole page most needs the headroom. */
const PLUTO_FRAGMENTS_LITE: PlutoFragment[] = PLUTO_FRAGMENTS.filter((_, i) => i % 2 === 0);
/** Every fourth, for the minimal tier — same stride reasoning as above. */
const PLUTO_FRAGMENTS_MINIMAL: PlutoFragment[] = PLUTO_FRAGMENTS.filter((_, i) => i % 4 === 0);

interface PlutoGeometry {
  bhCenterX: number;
  bhCenterY: number;
  plutoSize: number;
}

function measurePlutoGeometry(bhEl: HTMLElement, plutoEl: HTMLElement): PlutoGeometry {
  const bhRect = bhEl.getBoundingClientRect();
  const plutoRect = plutoEl.getBoundingClientRect();
  return {
    bhCenterX: bhRect.left + bhRect.width / 2,
    bhCenterY: bhRect.top + bhRect.height / 2,
    plutoSize: plutoRect.width,
  };
}

/** Swings the black hole's own glow to red for PLUTO_FLASH_HOLD seconds —
 * see .hb-blackhole.is-feeding in hub.css. Plain class + setTimeout rather
 * than a CSS `animation`, since (unlike the neutron merger's burst) this is
 * just two end states and a hold, which is what a transition already
 * expresses; a timeout owning the "how long" keeps that single number in
 * one place instead of split between JS's cadence and a CSS duration. */
function fireBlackHoleFeed(ref: React.RefObject<HTMLButtonElement>) {
  const el = ref.current;
  if (!el) return;
  el.classList.add("is-feeding");
  window.setTimeout(() => {
    el.classList.remove("is-feeding");
  }, PLUTO_FLASH_HOLD * 1000);
}

function usePlutoEvent(
  eventRef: React.RefObject<HTMLDivElement>,
  bodyRef: React.RefObject<HTMLDivElement>,
  fragments: PlutoFragment[],
  fragRefs: React.RefObject<(HTMLSpanElement | null)[]>,
  blackHoleRef: React.RefObject<HTMLButtonElement>
) {
  useEffect(() => {
    const eventEl = eventRef.current;
    const bhEl = blackHoleRef.current;
    if (!eventEl || !bhEl) return;
    // Static resting frame instead (see .hb-pluto-event's reduced-motion
    // rule in hub.css) — no rAF loop, and the black hole never flares.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let geo = measurePlutoGeometry(bhEl, eventEl);
    const onResize = () => {
      geo = measurePlutoGeometry(bhEl, eventEl);
    };
    window.addEventListener("resize", onResize);

    let raf = 0;
    const startedAt = performance.now();
    let fired = false;
    let wasDestroying = false;
    // Whether Pluto's own body was being held hidden as of the previous
    // frame — see the reset branch in tick() for what this guards.
    let bodyHidden = false;

    const tick = (now: number) => {
      const elapsed = (now - startedAt) / 1000;
      const cycleElapsed = elapsed % PLUTO_CYCLE;

      // Two regimes: a constant-speed approach down to the 150px tear
      // threshold, then — once destruction starts — a straight-line decay
      // to 0 over the fixed PLUTO_DESTROY_DURATION regardless of the
      // approach speed above it, since "all of it torn apart and pulled in
      // within 3 seconds" is a duration, not a speed.
      let gap: number;
      if (cycleElapsed < PLUTO_TEAR_START) {
        gap = PLUTO_START_GAP - PLUTO_SPEED * cycleElapsed;
      } else if (cycleElapsed < PLUTO_MOTION) {
        gap = PLUTO_TEAR_GAP * (1 - (cycleElapsed - PLUTO_TEAR_START) / PLUTO_DESTROY_DURATION);
      } else {
        gap = 0;
      }
      gap = Math.min(PLUTO_START_GAP, Math.max(0, gap));

      // --pluto-gap is the one per-frame write that always has to happen —
      // Pluto is visually moving (or, past PLUTO_MOTION, freshly consumed)
      // for the entire cycle. Everything below this — erosion, the
      // spaghettification stretch, all 40 fragments — only ever has
      // anything to actually draw during the destruction window itself
      // (TEAR_START through a short tail past MOTION for the last
      // fragments' own fade-outs), so it's skipped entirely outside that
      // window instead of doing (and writing) the same "nothing's
      // happening" result every frame for the ~80% of the cycle that's
      // just the approach and the post-flash hold. An earlier version did
      // that unconditional per-frame work for all 40 fragments regardless
      // of phase, which was real, measurable cost for no visual return.
      eventEl.style.setProperty("--pluto-gap", gap.toFixed(2));

      const destroying = cycleElapsed >= PLUTO_TEAR_START && cycleElapsed < PLUTO_DESTROY_TAIL_END;
      if (destroying) {
        if (!wasDestroying) {
          // Just entered the destroy window — this is the one moment
          // .hb-pluto-body actually needs its clip-path (see
          // .hb-pluto-body.is-tearing in hub.css for why that class isn't
          // just left on permanently).
          bodyRef.current?.classList.add("is-tearing");
        }

        // Tear progress is purely time-based (see PLUTO_TEAR_START/LEN
        // above) rather than derived from gap, since destruction's own
        // pace no longer tracks the approach speed once it starts.
        const p1 = Math.min(1, Math.max(0, (cycleElapsed - PLUTO_TEAR_START) / PLUTO_TEAR_LEN));

        // Spaghettification — see PLUTO_STRETCH_MAX/SQUASH_MAX's own
        // comment. Fades out over the tear phase's last 20%, so the
        // stretched thread has visibly thinned to nothing by the time the
        // swirl/dust phase (p1 already at 1 by then) takes over the
        // "being consumed" visual.
        const body = bodyRef.current;
        if (body) {
          const stretchX = 1 + p1 * PLUTO_STRETCH_MAX;
          const squashY = 1 - p1 * PLUTO_SQUASH_MAX;
          const bodyOpacity = p1 < 0.8 ? 1 : Math.max(0, 1 - (p1 - 0.8) / 0.2);
          body.style.transform = `scaleX(${stretchX.toFixed(3)}) scaleY(${squashY.toFixed(3)})`;
          body.style.opacity = bodyOpacity.toFixed(2);
          // Written straight onto the element the clip applies to — see
          // plutoErosionClip for why this is a CSS polygon() now rather than
          // an SVG <clipPath> mutated by reference.
          body.style.clipPath = plutoErosionClip(p1);
        }

        // gap is measured centre-to-centre (see PLUTO_START_GAP's own
        // comment), so Pluto's own centre is simply the hole's centre
        // minus that many px — no separate right-edge bookkeeping needed.
        const plutoCenterX = geo.bhCenterX - gap;
        const plutoRadius = geo.plutoSize * 0.34; // BASE_R/100 — see CelestialBody.tsx
        const frags = fragRefs.current;

        fragments.forEach((frag, i) => {
          const el = frags?.[i];
          if (!el) return;

          const activateElapsed =
            frag.kind === "chunk"
              ? PLUTO_TEAR_START + frag.activateAt * PLUTO_TEAR_LEN
              : PLUTO_SWIRL_START + frag.activateAt * PLUTO_SWIRL_LEN;
          const t = (cycleElapsed - activateElapsed) / frag.life;
          if (t < 0 || t > 1) {
            // Skip the write once it's already hidden — most fragments sit
            // in this branch most of the destroy window (each is only
            // actually mid-flight for a fraction of it), and re-writing
            // the same "0" every frame is exactly the kind of no-op DOM
            // mutation this whole gating pass is about cutting out.
            if (el.style.opacity !== "0") el.style.opacity = "0";
            return;
          }

          if (frag.kind === "chunk") {
            const rad = (frag.angleDeg * Math.PI) / 180;
            const rimX = plutoCenterX + plutoRadius * Math.cos(rad);
            const rimY = geo.bhCenterY + plutoRadius * Math.sin(rad);
            const outX = rimX + Math.cos(rad) * frag.fling;
            const outY = rimY + Math.sin(rad) * frag.fling;
            // A quadratic bezier from the rim, bulging outward through the
            // tidal-sling control point, curving in to the hole's centre —
            // eased (not linear) so the sling and the final plunge each
            // get their own visible pace instead of one constant-speed
            // sweep.
            const eased = t * t * (3 - 2 * t);
            const mt = 1 - eased;
            const x = mt * mt * rimX + 2 * mt * eased * outX + eased * eased * geo.bhCenterX;
            const y = mt * mt * rimY + 2 * mt * eased * outY + eased * eased * geo.bhCenterY;
            const rot = frag.spin * (t * frag.life);
            const scale = 1 - 0.55 * eased;
            const opacity = t < 0.12 ? t / 0.12 : t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.3) : 1;
            el.style.transform = `translate(${(x - frag.size / 2).toFixed(1)}px, ${(y - frag.size / 2).toFixed(1)}px) rotate(${rot.toFixed(0)}deg) scale(${scale.toFixed(2)})`;
            el.style.opacity = opacity.toFixed(2);
          } else {
            // Polar spiral around the hole's own centre — radius shrinks
            // linearly while the angle winds up as t^2, so the spin
            // visibly accelerates on the way in, the same "faster as it
            // narrows" read as water actually going down a drain.
            const r0 = frag.startR * plutoRadius;
            const r = r0 * (1 - t);
            const theta = frag.startTheta + frag.turns * Math.PI * 2 * (t * t);
            const x = geo.bhCenterX + r * Math.cos(theta);
            const y = geo.bhCenterY + r * Math.sin(theta);
            const scale = 1 - 0.4 * t;
            const opacity = t < 0.1 ? t / 0.1 : t > 0.75 ? Math.max(0, 1 - (t - 0.75) / 0.25) : 1;
            el.style.transform = `translate(${(x - frag.size / 2).toFixed(1)}px, ${(y - frag.size / 2).toFixed(1)}px) scale(${scale.toFixed(2)})`;
            el.style.opacity = opacity.toFixed(2);
          }
        });

        wasDestroying = true;
      } else if (wasDestroying) {
        // Just left the destroy window — reset every piece to its resting
        // state exactly once, rather than continuing to write it every
        // frame for the rest of the cycle.
        const body = bodyRef.current;
        if (body) {
          body.classList.remove("is-tearing");
          body.style.transform = "";
          body.style.clipPath = "";
          // NOT cleared back to its stylesheet value here, unlike the
          // transform above — that was the bug where a whole, intact Pluto
          // flashed back into view sitting on top of the black hole for a
          // second at the end of every cycle. This reset runs at
          // PLUTO_DESTROY_TAIL_END, but the cycle does not restart until
          // PLUTO_CYCLE (a second later, through the black hole's own flash
          // hold), and for that whole second --pluto-gap is 0 — meaning the
          // body's box is parked directly over the hole. Restoring its
          // opacity there un-consumed it. It stays hidden until a new cycle
          // has actually put it back at its starting distance, which the
          // approach branch below is what re-establishes.
          body.style.opacity = "0";
        }
        fragRefs.current?.forEach((el) => {
          if (el) el.style.opacity = "0";
        });
        wasDestroying = false;
      } else if (cycleElapsed < PLUTO_TEAR_START && bodyHidden) {
        // A fresh cycle: Pluto is back out at its full starting distance and
        // intact again, so it may be shown. Guarded on bodyHidden so this is
        // one write per cycle rather than one per frame for the ~10 seconds
        // of every approach.
        const body = bodyRef.current;
        if (body) body.style.opacity = "";
      }
      bodyHidden = cycleElapsed >= PLUTO_TEAR_START;

      // One-shot per cycle: fires the instant the approach finishes (gap
      // hits 0), then re-arms itself once a fresh cycle is clearly under
      // way again so the next merger can fire too.
      if (cycleElapsed >= PLUTO_MOTION) {
        if (!fired) {
          fired = true;
          fireBlackHoleFeed(blackHoleRef);
        }
      } else if (cycleElapsed < 0.5) {
        fired = false;
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [eventRef, bodyRef, fragments, fragRefs, blackHoleRef]);
}

/* ───────────────────────────── page ─────────────────────────────

   How heavy a scene this page draws. Three steps, each a strict subset of the
   one above it: `full` is the scene as designed, `lite` trims what costs the
   most per frame, `minimal` keeps only what the page cannot be without.

   The tier is CHOSEN BY MEASUREMENT, not by guessing at the device. An
   earlier version of this guessed — coarse pointer, low core count — and that
   is exactly what failed: an iPad reports `pointer: fine` and `hover: hover`
   the moment a trackpad or a pencil is paired with it, so the tablet this
   whole mechanism exists for was being served the full desktop scene and none
   of the work below ever applied to it. Feature-detecting a GPU's fill rate
   is not something a browser exposes, and every proxy for it is wrong on some
   real device.

   So: start where the old guess would have started (it is a fine first
   guess), then watch the frames the device actually delivers and step down if
   they do not arrive. That is self-correcting on hardware nobody tested, and
   it needs no list of device names to keep up to date. */
type SceneTier = "full" | "lite" | "minimal";

const TIER_ORDER: SceneTier[] = ["full", "lite", "minimal"];

function initialTier(): SceneTier {
  if (HB_TIER === "full" || HB_TIER === "lite" || HB_TIER === "minimal") return HB_TIER;
  if (typeof window === "undefined") return "full";
  if (window.matchMedia("(hover: none), (pointer: coarse)").matches) return "lite";
  return (navigator.hardwareConcurrency ?? 8) <= 4 ? "lite" : "full";
}

/** Frames per second under which a tier is considered not to be holding up.
 * 45 rather than 60: a device sitting just under the display's own refresh is
 * doing fine, and stepping the scene down over that would cost the visitor
 * detail for nothing. */
const TIER_DOWN_FPS = 45;
/** …and under this, one step down is not going to be enough — go straight to
 * the bottom rather than spending another sampling window on the way. */
const TIER_FLOOR_FPS = 20;
/** Length of one sampling window. Long enough to average over a hitch, short
 * enough that a struggling device is not left struggling for long. */
const TIER_SAMPLE_MS = 1500;

function useSceneTier(): SceneTier {
  const [tier, setTier] = useState<SceneTier>(initialTier);

  useEffect(() => {
    // An explicit ?hbtier= is a measurement instruction — the whole point of
    // it is to hold a tier still and compare, so auto-stepping would fight it.
    if (HB_TIER) return;
    if (tier === "minimal") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let frames = 0;
    let since = 0;
    // The first window is thrown away: mount, the entrance transition, image
    // decodes and the first data fetch all land inside it, and none of them
    // say anything about what this device sustains once the scene is running.
    let warmup = true;

    const tick = (now: number) => {
      if (!since) since = now;
      frames += 1;
      if (now - since >= TIER_SAMPLE_MS) {
        const fps = (frames * 1000) / (now - since);
        frames = 0;
        since = now;
        if (warmup) {
          warmup = false;
        } else if (fps < TIER_FLOOR_FPS) {
          setTier("minimal");
          return;
        } else if (fps < TIER_DOWN_FPS) {
          setTier(TIER_ORDER[Math.min(TIER_ORDER.indexOf(tier) + 1, TIER_ORDER.length - 1)]);
          return;
        } else {
          // Held up for a full window past warm-up. Stop measuring rather
          // than run a rAF loop forever to keep confirming the same thing.
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tier]);

  return tier;
}

/* ── diagnostics ──────────────────────────────────────────────────────────
   Query-string switches, inert unless the URL actually carries them, so they
   cost a visitor nothing. They exist because this page's frame rate is a
   device problem: it is fine on the machines it gets developed on and was
   measured at two frames a second on an iPad, and there is no way to profile
   that remotely — so instead of guessing at which layer is responsible,
   whoever has the device in hand can switch layers off one at a time and read
   the number straight off the screen.

     ?hbfps            live frames-per-second and the current tier, in the
                       corner. The tier matters as much as the number: it is
                       what says whether the reductions are even in effect.
     ?hbtier=full      hold the scene at one tier instead of letting it step
     ?hbtier=lite      down on its own — the only way to compare two tiers on
     ?hbtier=minimal   the same device.
     ?hboff=a,b,c      hide whole subsystems. Any of:
                         space    the entire sky layer (nebulae, stars, …)
                         nebula   just the three blurred colour clouds
                         twinkle  just the scintillating stars
                         system   the solar system: orbits, planets, moons
                         star     just the sun (its surface filter is the
                                  most expensive single thing on the page)
                         planets  just the eight orbiting planets
                         rings    just the orbit rings
                         belt     just the asteroid belt
                         spin     freezes every planet's rotating texture
                         bh       the black hole
                         pluto    the Pluto/black-hole vignette
                         neutron  the neutron binary

   Turning exactly one of these off and watching ?hbfps jump is what
   identifies the cost; everything else is inference. */
const HB_PARAMS = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
const HB_TIER = (HB_PARAMS?.get("hbtier") ?? null) as SceneTier | null;
const HB_FPS = HB_PARAMS?.has("hbfps") ?? false;
const HB_OFF: string[] = (HB_PARAMS?.get("hboff") ?? "").split(",").filter(Boolean);

/** Frames actually delivered over the last second. Deliberately its own rAF
 * loop writing straight to a ref — routing this through React state would
 * re-render the whole page 60 times a second and measure itself. */
function FpsMeter({ tier }: { tier: SceneTier }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let since = performance.now();
    const tick = (now: number) => {
      frames += 1;
      if (now - since >= 500) {
        const fps = (frames * 1000) / (now - since);
        if (ref.current) ref.current.textContent = `${fps.toFixed(0)} fps`;
        frames = 0;
        since = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="hb-fps">
      <span ref={ref}>— fps</span> · {tier}
    </div>
  );
}

export default function Hub() {
  const { lang } = useLanguage();
  const en = lang === "en";
  useDocumentTitle("K-Stock Hub");

  const [kospi, setKospi] = useState<IndexQuote | null>(null);
  const [kosdaq, setKosdaq] = useState<IndexQuote | null>(null);
  const [globals, setGlobals] = useState<GlobalIndexWidget[]>([]);
  const [entered, setEntered] = useState(false);
  const tier = useSceneTier();
  const lite = tier !== "full";
  const minimal = tier === "minimal";

  const stageRef = useRef<HTMLDivElement>(null);
  const neutronRef = useRef<HTMLButtonElement>(null);
  const neutronFlashRef = useRef<HTMLDivElement>(null);
  const supernovaRef = useRef<HTMLDivElement>(null);
  useNeutronBinary(neutronRef, neutronFlashRef, supernovaRef);

  const blackHoleRef = useRef<HTMLButtonElement>(null);
  const plutoEventRef = useRef<HTMLDivElement>(null);
  const plutoBodyRef = useRef<HTMLDivElement>(null);
  const plutoFragRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const plutoFragments = minimal ? PLUTO_FRAGMENTS_MINIMAL : lite ? PLUTO_FRAGMENTS_LITE : PLUTO_FRAGMENTS;
  usePlutoEvent(plutoEventRef, plutoBodyRef, plutoFragments, plutoFragRefs, blackHoleRef);

  /* The page's entire data budget: two cached endpoints, one poll. */
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .indices(false)
        .then((res) => {
          if (cancelled) return;
          setKospi(res.kospi);
          setKosdaq(res.kosdaq);
        })
        .catch(() => {
          // A missed refresh just leaves the planets showing their last move.
        });
      api
        .globalIndices()
        .then((res) => {
          if (!cancelled) setGlobals(res.items);
        })
        .catch(() => {});
    };
    load();
    const stop = startVisibilityAwareInterval(load, INDEX_POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  /* Entrance: the system unfolds once, on mount. */
  useEffect(() => {
    const id = window.setTimeout(() => setEntered(true), 60);
    return () => window.clearTimeout(id);
  }, []);

  /* Pointer parallax. Written straight to CSS custom properties on the stage
     rather than through React state — this fires on every pointermove, and a
     re-render per frame would drop the orbit animations onto the main thread's
     critical path for no visual gain. */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Coarse pointers have no hover to track, and tilting the scene on touch
    // would fight the tap the visitor is actually making.
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    let frame = 0;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;

    const onMove = (event: PointerEvent) => {
      targetX = (event.clientX / window.innerWidth - 0.5) * 2;
      targetY = (event.clientY / window.innerHeight - 0.5) * 2;
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const tick = () => {
      // Eased toward the pointer instead of snapped to it, so the scene drifts
      // after the cursor rather than twitching with it.
      currentX += (targetX - currentX) * 0.06;
      currentY += (targetY - currentY) * 0.06;
      stage.style.setProperty("--px", currentX.toFixed(4));
      stage.style.setProperty("--py", currentY.toFixed(4));
      if (Math.abs(targetX - currentX) > 0.001 || Math.abs(targetY - currentY) > 0.001) {
        frame = requestAnimationFrame(tick);
      } else {
        frame = 0;
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  /* Every twinkler is its own composited layer (see .hb-twinkle's will-change
     in hub.css) carrying a three-stop box-shadow, and they all animate
     continuously — 84 of those is a fine load for a desktop GPU and a real
     one for a tablet. Cut hard on the lite tier; the field is randomly
     distributed, so a smaller count reads as a slightly sparser sky rather
     than as a missing region of it, and the three box-shadow star layers
     underneath (~680 stars, painted once and never animated) are what
     actually makes the sky look full — these are only the ones that
     scintillate on top of it. */
  const twinklers = useMemo(() => twinkleField(90210, minimal ? 0 : lite ? 24 : 84), [lite, minimal]);

  const skies = useMemo(
    () => ({
      far: starLayer(20260726, 420, 2400, 0.7),
      mid: starLayer(778112, 190, 2400, 1.1),
      near: starLayer(31337, 70, 2400, 1.7),
    }),
    []
  );

  // Inset a margin in from Mars's 355 and Jupiter's 440 (see PLANETS) so the
  // belt reads as strictly between the two, not touching either ring.
  /* 280 rocks is 280 elements living inside `.hb-plane`, i.e. inside the
     page's `preserve-3d` stage — where a browser cannot flatten them into one
     cached layer the way it would for a flat 2D group, and has to carry each
     through the 3D pipeline on its own while the belt's shared rotation runs.
     Cut hard on the lite tier rather than dropped: at 70 the band still reads
     as scattered debris between Mars and Jupiter, which is all it ever needs
     to do at this scale. */
  const asteroids = useMemo(
    () => asteroidBelt(614529, minimal ? 0 : lite ? 70 : 280, 372, 424),
    [lite, minimal]
  );

  const feed = useMemo(() => {
    const bySymbol = new Map<string, number | null>();
    globals.forEach((item) => {
      // The backend labels these by key; both US majors are always present in
      // the payload, and anything missing simply prints no number.
      if (item.key.includes("sp500") || item.label.toUpperCase().includes("S&P")) {
        bySymbol.set("SPX", item.change_pct);
      }
      if (item.key.includes("nasdaq") || item.label.toUpperCase().includes("NASDAQ")) {
        bySymbol.set("NDX", item.change_pct);
      }
    });
    return {
      KOSPI: kospi?.change_pct ?? null,
      KOSDAQ: kosdaq?.change_pct ?? null,
      SPX: bySymbol.get("SPX") ?? null,
      NDX: bySymbol.get("NDX") ?? null,
    };
  }, [kospi, kosdaq, globals]);

  const status = (() => {
    const raw = (kospi?.market_status ?? kosdaq?.market_status ?? "").toUpperCase();
    if (raw === "OPEN") return { label: en ? "MARKET OPEN" : "장중", tone: "open" };
    if (raw === "PREOPEN") return { label: en ? "PRE-OPEN" : "장 시작 전", tone: "pre" };
    if (raw === "CLOSE") return { label: en ? "MARKET CLOSED" : "장 마감", tone: "closed" };
    return { label: en ? "CONNECTING" : "연결 중", tone: "sync" };
  })();

  const open = (to: string) => navigate(to);

  return (
    <div
      className={[
        "hb",
        entered ? "is-entered" : "",
        lite ? "is-lite" : "",
        minimal ? "is-minimal" : "",
        ...HB_OFF.map((name) => `hb-off-${name}`),
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {HB_FPS && <FpsMeter tier={tier} />}
      {/* ── deep space ── */}
      <div className="hb-space" aria-hidden="true">
        <div className="hb-milkyway" />
        <div className="hb-nebula hb-nebula--a" />
        <div className="hb-nebula hb-nebula--b" />
        <div className="hb-nebula hb-nebula--c" />
        <div className="hb-galaxy" />
        <div className="hb-stars hb-stars--far" style={{ boxShadow: skies.far }} />
        <div className="hb-stars hb-stars--mid" style={{ boxShadow: skies.mid }} />
        <div className="hb-stars hb-stars--near" style={{ boxShadow: skies.near }} />
        <div className="hb-twinklers">
          {twinklers.map((t, i) => (
            <span
              key={i}
              className={`hb-twinkle ${t.flare ? "has-flare" : ""}`}
              style={{
                left: `${t.x}%`,
                top: `${t.y}%`,
                width: `${t.size}px`,
                height: `${t.size}px`,
                animationDuration: `${t.dur}s`,
                animationDelay: `${t.delay}s`,
                ["--peak" as string]: String(t.peak),
                ["--tc" as string]: t.color,
              }}
            />
          ))}
        </div>
        <div className="hb-shooting hb-shooting--1" />
        <div className="hb-shooting hb-shooting--2" />
        <div className="hb-vignette" />
      </div>

      {/* ── minimal chrome: no header bar, just the two controls the page's own
             copy depends on (language) and the theme the whole site shares ── */}
      <div className="hb-controls">
        <LanguageToggle />
        <ThemeToggle />
      </div>

      <HubClocks />

      {/* Voyager, on its way out of the system. Deliberately outside the 3D
          stage below: inside it the craft would be depth-sorted against the
          orbital plane and, like everything else in that subtree, could not take
          a click. It launches from the outermost orbit, coasts out of frame, and
          starts over. */}
      <a
        href="/news"
        className="hb-voyager"
        aria-label={en ? "Probe: global news" : "탐사선: 글로벌 뉴스"}
        title={en ? "Voyager 1 — leaving the system" : "보이저 1호 — 태양계를 벗어나는 중"}
        onClick={(e) => {
          e.preventDefault();
          open("/news");
        }}
      >
        <VoyagerCraft />
        <span className="hb-voyager-tip">{en ? "GLOBAL NEWS" : "글로벌 뉴스"}</span>
      </a>

      {/* The way into the KOSPI TOP 100 board — a destination nothing else on
          this page carries, unlike the KOSPI map it used to open, which Earth
          and the Moon both still reach from the orbital plane. Its counterpart
          is the neutron binary below, which opens the KOSDAQ board on the same
          logic (Venus still carries the KOSDAQ map).
          Fixed to the viewport for the same reason
          `.hb-voyager` sits outside `.hb-stage`: it isn't part of the solar
          system's 3D geometry, so it has no business inside the tilted plane
          that geometry lives on. No oversized wrap box around this one the
          way `.hb-starwrap` has around the sun — that box exists to work
          around a Chromium quirk that only bites inside `.hb-system`'s
          preserve-3d stage (see that comment), which this button, sitting
          outside the stage with no 3D transforms of its own, was never
          part of; a copied-over wrap box here only added a second layer of
          corner-anchor math to get wrong; see hub.css. */}
      <button
        type="button"
        ref={blackHoleRef}
        className="hb-blackhole"
        onClick={() => open("/kospi-100")}
        aria-label={en ? "Black hole: KOSPI TOP 100" : "블랙홀: 코스피 TOP 100"}
        title={en ? "Gargantua — KOSPI TOP 100" : "가르강튀아 — 코스피 TOP 100"}
      >
        {/* The hole's breathing bloom, deliberately a sibling of the art
            rather than part of it — see .hb-bh-bloom in hub.css for why an
            animation living inside that SVG was re-inking the entire
            accretion disc on every frame. */}
        <span className="hb-bh-bloom" aria-hidden="true" />
        <BlackHoleBody id="hub" lite={lite} minimal={minimal} />
        {/* Named on hover the way Voyager is. The bodies on the orbital plane
            get their destination from the planet you already recognise; the
            hole doesn't, and it is now the only route to the TOP 100 boards,
            so it says so. Sits above the art rather than below it — this
            button is anchored to the bottom-right corner, where a tip hung
            underneath would fall off the viewport. */}
        {/* Names the market, not just "TOP 100" — the neutron binary opens the
            KOSDAQ board, so a generic label on either one would leave the pair
            looking like two routes to the same place. */}
        <span className="hb-blackhole-tip">{en ? "KOSPI TOP 100" : "코스피 TOP 100"}</span>
      </button>

      {/* Pluto, drifting in from the black hole's left and eventually
          consumed by it — see usePlutoEvent above for the full timeline
          (approach, then tidal tearing and a final debris swirl once the
          gap hits 150px, all of it torn apart within 3 seconds, then the
          black hole's own red flare, a reset, and repeat), per an explicit
          request. What actually tears .hb-pluto-body apart is a CSS
          `clip-path: polygon()` written onto it per frame — see
          plutoErosionClip, including why that replaced the hidden
          `<svg><clipPath>` that used to sit right here. Sits outside
          `.hb-stage` for the same reason the black hole and Voyager do: it
          isn't part of the solar system's own orbital geometry. */}
      <div className="hb-pluto-event" ref={plutoEventRef} aria-hidden="true">
        <div className="hb-pluto-body" ref={plutoBodyRef}>
          <PhotoPlanetBody id="pluto" skin={PLUTO_SKIN} />
        </div>
      </div>

      {/* Pluto's own torn-off chunks and final dust swirl — a separate,
          full-viewport layer rather than nested inside .hb-pluto-event
          above; see the comment on .hb-pluto-fx in hub.css for why each
          fragment's flight needs plain screen coordinates instead of that
          box's own constantly-moving one. */}
      <div className="hb-pluto-fx" aria-hidden="true">
        {plutoFragments.map((frag, i) => (
          <span
            key={i}
            className={`hb-pluto-frag hb-pluto-frag--${frag.kind}`}
            ref={(el) => {
              plutoFragRefs.current[i] = el;
            }}
            style={{ width: `${frag.size}px`, height: `${frag.size}px` }}
          />
        ))}
      </div>

      {/* Two equal-size neutron stars, mutually orbiting a shared centre
          along a single horizontal line (facing each other, side to side)
          rather than one orbiting the other or a full circular sweep, per an
          explicit request. See useNeutronBinary above and
          .hb-neutron-binary/.hb-neutron-flash in hub.css for the timing:
          period and separation shrink together — 5s→4s→3s→2s→1s→0.5s→0.2s,
          20 laps total — then the pair plunges together into one merged body,
          firing a screen-wide gamma-ray-burst-style flash at the instant of
          merger, holds merged for thirty seconds while the ejecta cloud
          expands across the sky behind it, then splits back apart to start
          the next cycle.

          A real control now (the KOSDAQ TOP 100 board — the black hole's
          counterpart, on the same logic: Venus already carries the KOSDAQ map
          out on the orbital plane, so this is free to name the destination
          nothing else here reaches), which is why it sits out here
          rather than inside `.hb-space` where it used to: that layer is
          `aria-hidden`, and a focusable button inside an aria-hidden subtree
          is reachable by tab and invisible to a screen reader at the same
          time, which is worse than either alone. `.hb-space` is `inset: 0` on
          `.hb`, so moving up one level leaves its own absolute position
          exactly where it was. */}
      <button
        type="button"
        ref={neutronRef}
        className="hb-neutron-binary"
        onClick={() => open("/kosdaq-100")}
        aria-label={en ? "Neutron binary: KOSDAQ TOP 100" : "중성자 쌍성: 코스닥 TOP 100"}
        title={en ? "Neutron star merger — KOSDAQ TOP 100" : "중성자별 병합 — 코스닥 TOP 100"}
      >
        <span className="hb-neutron-star hb-neutron-star--a" />
        <span className="hb-neutron-star hb-neutron-star--b" />
        {/* What the two of them become: one blue remnant at twice a single
            star's size, held for thirty seconds before it splits back apart
            and the next inspiral starts, per an explicit request.

            The bars are diffraction spikes, matched to a reference photo of
            the real thing. One bar is two opposing spikes, so this is eight
            spikes, not six — and the split matters, because it is what makes
            the shape recognisable rather than merely six-fold. Three bright
            bars at 30°/90°/150° give the six spikes the hexagonal primary
            mirror produces (60° apart, and note that one of them is
            VERTICAL — a set at 0°/60°/120° is the same six-fold symmetry
            rotated, and reads wrong: it puts a bright pair on the horizontal
            where the real image has its faintest). The fourth bar is the
            horizontal pair thrown by the secondary mirror's support strut,
            which in the photograph is visibly shorter and dimmer than the
            other six — see .hb-neutron-spike--strut in hub.css. */}
        <span className="hb-neutron-merged">
          <i className="hb-neutron-spike" style={{ ["--sa" as string]: "30deg" }} />
          <i className="hb-neutron-spike" style={{ ["--sa" as string]: "90deg" }} />
          <i className="hb-neutron-spike" style={{ ["--sa" as string]: "150deg" }} />
          <i
            className="hb-neutron-spike hb-neutron-spike--strut"
            style={{ ["--sa" as string]: "0deg" }}
          />
        </span>
        {/* Named on hover, like the black hole and Voyager. This body sits in
            open sky rather than a corner, so its tip hangs below — nothing to
            fall off, and it keeps the label clear of the merged remnant's
            diffraction spikes above. */}
        <span className="hb-neutron-tip">{en ? "KOSDAQ TOP 100" : "코스닥 TOP 100"}</span>
      </button>
      {/* The merger's first half-second: the white gamma-ray-burst flash (see
          useNeutronBinary/fireMergerBurst above) — fixed to the whole viewport
          rather than scoped to `.hb-space`, since "화면 전체를 밝게" means the
          entire screen, not just the hero section the binary itself sits in.
          See .hb-neutron-flash in hub.css. */}
      <div className="hb-neutron-flash" ref={neutronFlashRef} aria-hidden="true" />

      {/* …and the thirty seconds after it: the ejecta cloud, expanding from
          the merger point out across the whole sky and fading to nothing just
          as the remnant splits back apart. See the "supernova ejecta" section
          above for what it is modelled on and .hb-supernova in hub.css for how
          each layer is built.

          Sits BELOW `.hb-stage` in the stacking order (see its z-index) so it
          expands behind the solar system and the wordmark rather than over
          them — 배경에 걸쳐, across the background. The shells are hollow, so
          the merged remnant itself stays visible in the middle of its own
          explosion; `mix-blend-mode: screen` means every layer can only ever
          ADD light to the starfield underneath, never box it out, which is
          what keeps a full-screen effect from reading as a pasted-on
          rectangle. */}
      <div className="hb-supernova" ref={supernovaRef} aria-hidden="true">
        {/* The leading shock front, the blue-white ring that runs out ahead of
            everything else and is off the screen inside a few seconds. Still a
            CSS gradient: it is thin, bright and moving fast enough that the
            procedural gas below would be wasted on it. */}
        <span className="hb-sn-shock" />
        {/* The fireball, likewise still a plain gradient — for its first
            couple of seconds the material really is an opaque, structureless
            ball of light, and it is mostly hidden under the flash anyway. */}
        <span className="hb-sn-shell hb-sn-shell--core" />
        {/* The body of the remnant: four procedurally warped gas shells (see
            SupernovaGas in CelestialBody.tsx) expanding at their own rates and
            cooling through their own colours. These replaced four smooth CSS
            ring gradients plus two counter-rotating conic "spoke" layers —
            perfect ramps banded against the dark sky and read as airbrushed
            hoops, and evenly spaced radial spokes are a symmetry no real
            remnant has. Turbulence-displaced ramps with a lacy filament net
            over them is what the Crab actually looks like.
            The synchrotron haze is painted first, so it sits INSIDE the
            filamentary shells the way it does in the real object. */}
        <SupernovaGas id="hub" variant="synchrotron" />
        <SupernovaGas id="hub" variant="hot" />
        <SupernovaGas id="hub" variant="main" />
        <SupernovaGas id="hub" variant="outer" />
        {EJECTA_KNOTS.map((knot, i) => (
          <span
            key={i}
            className="hb-sn-knot"
            style={
              {
                "--a": `${knot.angle.toFixed(1)}deg`,
                "--d": `${knot.distance.toFixed(1)}vmax`,
                "--sz": `${knot.size.toFixed(1)}vmax`,
                "--tint": knot.tint,
                "--grow": knot.grow.toFixed(2),
                animationDelay: `${knot.delay.toFixed(2)}s`,
                animationDuration: `${knot.duration.toFixed(2)}s`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <div className="hb-stage" ref={stageRef}>
        <div className="hb-parallax">
          {/* ── title ── */}
          <header className="hb-lockup">
            <span className={`hb-status is-${status.tone}`}>
              <span className="hb-status-dot" aria-hidden="true" />
              {status.label}
            </span>
            <h1 className="hb-wordmark">
              <span className="hb-wordmark-main">K-STOCK</span>
              <span className="hb-wordmark-sub">HUB</span>
            </h1>
            <p className="hb-tagline">
              {en ? "Every market signal, in one place." : "증시의 모든 정보가 여기서 만납니다"}
            </p>
          </header>

          {/* ── the system ── */}
          <div className="hb-system">
            <div className="hb-plane">
              {/* One ring per planet, at exactly that planet's radius, so every
                  body sits on a track of its own rather than sharing three. */}
              {PLANETS.map((spec) => (
                <div
                  key={spec.key}
                  className="hb-ring"
                  style={{ "--r": String(spec.radius) } as React.CSSProperties}
                >
                  <span className="hb-ring-base" />
                  <span className="hb-ring-arc" style={{ animationDuration: `${spec.duration * 1.6}s` }} />
                </div>
              ))}

              {/* The asteroid belt, between Mars and Jupiter's tracks — see
                  the "asteroid belt" section above for why each rock's own
                  position skips --orbit-base. Rendered as real (if tiny)
                  elements rather than the starfield's box-shadow trick,
                  since these need to sit in this same tilted plane as the
                  rings above and travel with it, not sit on a flat
                  background layer behind everything. The whole belt spins
                  together as one rigid group — every rock is a plain round
                  dot, so unlike the black hole's flattened disc there is no
                  "axis" for a shared rotation to visibly distort. */}
              <div className="hb-asteroid-belt" aria-hidden="true">
                {asteroids.map((rock, i) => (
                  <span
                    key={i}
                    className="hb-asteroid"
                    style={
                      {
                        "--mx": rock.mx.toFixed(2),
                        "--my": rock.my.toFixed(2),
                        width: `${rock.size.toFixed(2)}px`,
                        height: `${rock.size.toFixed(2)}px`,
                        background: `rgb(${rock.color})`,
                      } as React.CSSProperties
                    }
                  />
                ))}
              </div>
            </div>

            {/* Planets are direct .hb-system children — NOT nested inside
                .hb-plane like the rings above — so each one's front/back
                relationship to the star can be driven by plain z-index (see
                .hb-orbiter's hb-orbit-depth animation in hub.css) instead of
                relying on the browser to 3D-depth-sort across the .hb-plane/
                .hb-starwrap sibling boundary. That cross-boundary sort is
                real per spec (both are preserve-3d children of this same
                .hb-system) and does work on most browsers, but iPad/iOS
                Safari renders it inconsistently — a planet's box starts
                painting over the sun well before its actual orbital position
                would place it in front. .hb-orbit's keyframes now carry
                rotateX(var(--tilt)) directly (baked into the same transform
                that used to come for free from being .hb-plane's child), so
                moving out here changes nothing about each planet's own
                position or its billboard's face-the-camera cancellation
                math — only which element the browser has to cross-sort
                against the star. */}
            {PLANETS.map((spec) => (
              <Planet
                key={spec.key}
                spec={spec}
                change={spec.feed ? feed[spec.feed] : null}
                en={en}
                onOpen={open}
              />
            ))}

            {/* ── the star: the hub itself, and the way in ──
                The three soft light layers are siblings of the button rather
                than children of it. Inside the button they overflowed its
                composited layer (it is lifted on Z within a preserve-3d
                subtree) and Chromium clipped that layer's ink to a hard-edged
                rectangle of light around the sun. Out here they are on an
                untransformed layer with bounds that actually contain them. */}
            <div className="hb-starwrap">
              <StarBody id="hub" />
              <button
                type="button"
                className="hb-star"
                onClick={() => open("/dashboard")}
                aria-label={en ? "Star: Home (dashboard)" : "항성: 홈 (대시보드)"}
              >
                <span className="hb-star-face">
                  <span className="hb-star-dest">HUB</span>
                </span>
              </button>
            </div>
          </div>

          {/* ── hint ── */}
          <footer className="hb-hint">
            <p>
              {en
                ? "Tap the star to open the dashboard — or pick a planet."
                : "중심의 별을 누르면 대시보드로, 행성을 누르면 각 섹션으로 이동합니다"}
            </p>
          </footer>
        </div>
      </div>

      {/* Text routes to every destination, outside the 3D scene. The planets are
          buttons and reachable by keyboard, but a crawler (and a reader on a
          screen reader skimming for links) should not have to infer the site map
          from an animated transform stack. */}
      <nav className="sr-only" aria-label={en ? "All sections" : "전체 메뉴"}>
        <Link to="/dashboard">{en ? "Dashboard" : "대시보드"}</Link>
        {PLANETS.map((p) => (
          <Link key={p.key} to={p.to}>
            {en ? p.en : p.ko}
          </Link>
        ))}
      </nav>
    </div>
  );
}
