import { useEffect, useMemo, useRef, useState } from "react";
import { GlobalIndexWidget, IndexQuote, api } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link, navigate } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import { BASE_R, BlackHoleBody, PhotoPlanetBody, PhotoSkin, RocketCraft, SatelliteCraft, StarBody, VoyagerCraft } from "./CelestialBody";
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
    <div className="hb-orbiter" style={style}>
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
  );
}

/* ───────────────────────────── page ───────────────────────────── */

export default function Hub() {
  const { lang } = useLanguage();
  const en = lang === "en";
  useDocumentTitle("K-Stock Hub");

  const [kospi, setKospi] = useState<IndexQuote | null>(null);
  const [kosdaq, setKosdaq] = useState<IndexQuote | null>(null);
  const [globals, setGlobals] = useState<GlobalIndexWidget[]>([]);
  const [entered, setEntered] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);

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

  const twinklers = useMemo(() => twinkleField(90210, 84), []);

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
  const asteroids = useMemo(() => asteroidBelt(614529, 280, 372, 424), []);

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
    <div className={`hb ${entered ? "is-entered" : ""}`}>
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
        {/* Two equal-size neutron stars, mutually orbiting a shared centre
            (not one orbiting the other) — a single rotating pivot holding
            both bodies at opposite ends of one diameter, per an explicit
            request. See .hb-neutron-binary in hub.css for the spin/glow
            timing (2s→1s→0.5s→0.2s orbital period over the first 10s, then
            a faster 1s→0.5s→0.2s sweep repeating forever, brightness rising
            with speed at every stage). */}
        <div className="hb-neutron-binary" aria-hidden="true">
          <div className="hb-neutron-orbit">
            <span className="hb-neutron-star hb-neutron-star--a" />
            <span className="hb-neutron-star hb-neutron-star--b" />
          </div>
        </div>
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

      {/* A second, purely decorative way into the dashboard, parked in the
          corner rather than on the orbital plane — same destination as the
          star, so it carries no separate aria semantics beyond naming itself
          as a curiosity. Fixed to the viewport for the same reason
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
        className="hb-blackhole"
        onClick={() => open("/dashboard")}
        aria-label={en ? "Black hole: Home (dashboard)" : "블랙홀: 홈 (대시보드)"}
        title={en ? "Gargantua" : "가르강튀아"}
      >
        <BlackHoleBody id="hub" />
      </button>

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
