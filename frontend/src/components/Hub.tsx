import { useEffect, useMemo, useRef, useState } from "react";
import { GlobalIndexWidget, IndexQuote, api } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link, navigate } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import { BASE_R, BlackHoleBody, PhotoPlanetBody, PhotoSkin, SatelliteCraft, StarBody, StarshipCraft, SupernovaGas, VoyagerCraft } from "./CelestialBody";
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
    to: "/global-top100",
    ko: "글로벌 시총",
    en: "GLOBAL TOP 100",
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
   - "rocket": Mars's satellite — SpaceX's Starship, via CelestialBody's
     StarshipCraft (a real cropped/keyed launch photo now, not a drawn
     stand-in — an explicit request; see StarshipCraft's own comment for the
     source/license). There's no stock page to link to (SpaceX isn't listed
     on any exchange this app tracks), so it links to /global?code=SPCX
     (GlobalStockPage, which reads ?code= itself) per an explicit request for
     that destination instead.
   - "lunar": Earth's other satellite — the actual Moon, orbiting further out
     than the two stock badges. No text/tooltip by design (an explicit
     request: unlike the other two kinds, nothing is written on or over it),
     just an aria-label for screen readers; clicking it opens the same /map
     KOSPI destination Earth itself does.
   - "galilean": real-textured moons of a planet other than Earth/Mars — used
     for both Jupiter's four largest (Io, Europa, Ganymede, Callisto) and
     Saturn's three (Mimas, Enceladus, Titan), real closest-to-farthest order
     within each set, each on its own ring so a set's own moons never cross
     (see gapUnits on JUPITER_MOONS/SATURN_MOONS). Desktop-only (see
     .hb-ring-moons in hub.css) and, like "lunar", flattened into an
     equatorial ellipse rather than a full circle — the real moons in both
     sets do orbit in their planet's own equatorial plane, so sharing that
     ellipse read is the accurate choice here, not just a borrowed style. */

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
  kind: "stock" | "rocket" | "lunar" | "galilean";
  /** Stock code for StockIcon — only set when kind is "stock". */
  code?: string;
  /** Galilean moons only: each gets its own real texture/spin rather than
   * sharing one skin the way "lunar" shares MOON_SKIN. */
  skin?: PhotoSkin;
  /** Galilean moons only: the moon's own rendered diameter, in flat
   * --body-unit multiples — unlike "lunar" (a fraction of EARTH's --size),
   * this has to hold a fixed ratio to the real Moon's own rendered size
   * regardless of Jupiter's much bigger --size, so it's pinned to the same
   * unit hb-moon--lunar's width divides out of Earth's own size (90 / 3 =
   * 30 — see MOON_UNIT) rather than derived from Jupiter's at all. */
  sizeUnits?: number;
  /** Galilean moons only: how far past Jupiter's own edge this ring sits, in
   * the same flat --body-unit multiples as sizeUnits (not the stock/rocket
   * moons' px offsetPx) — increasing per moon by more than the neighbouring
   * pair's combined half-sizes, so the four rings clear each other. */
  gapUnits?: number;
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

// One real Moon diameter, in the same --body-unit multiples hb-moon--lunar's
// own width divides out of Earth's --size (90 / 3) — see sizeUnits' comment
// on MoonSpec. JUPITER_MOONS' own sizeUnits are this times each moon's
// requested ratio to the Moon (1/2, 1, 1.5, 3/5), not to Jupiter or to each
// other directly.
const MOON_UNIT = 30;

// Real photographic textures, not the solarsystemscope.com CC BY 4.0 pack
// the seven hub planets and the Moon use (it doesn't cover any moon past
// Earth's own) — these four are NASA/Galileo-mission mosaics via the USGS
// Astrogeology Science Center (public domain US government work), locally
// cropped-in on their few small no-coverage gaps near each pole and
// downsampled to match this project's other textures, same as every other
// body on this page. spinSeconds increase outward (Io fastest, Callisto
// slowest) — a small, free nod to the real Galilean moons' own orbital
// periods actually working the same way, same idea as Venus/Uranus's
// reverseSpin elsewhere in PLANETS.
const IO_SKIN: PhotoSkin = { texture: "/img/planets/io.webp", spinSeconds: 5, glow: "#d9a85f" };
const EUROPA_SKIN: PhotoSkin = { texture: "/img/planets/europa.webp", spinSeconds: 7, glow: "#d8cfba" };
const GANYMEDE_SKIN: PhotoSkin = { texture: "/img/planets/ganymede.webp", spinSeconds: 9, glow: "#9c9483" };
const CALLISTO_SKIN: PhotoSkin = { texture: "/img/planets/callisto.webp", spinSeconds: 11, glow: "#5f5c56" };

// Real closest-to-farthest order (also this array's own order, though that
// only affects initial DOM paint order — each ring's actual near/far pass
// over Jupiter comes from hb-moon-depth's z-index swap, same as the Moon's).
// gapUnits climbs by just over each pair's combined half-sizes (see
// MoonSpec's comment) — worked out from sizeUnits below: 1.5 (matching the
// Moon's own tight hug of Earth), then +(7.5+15+1), +(15+22.5+1),
// +(22.5+9+1), leaving a consistent ~1-unit clear margin between every ring
// — as tight as they can sit without two rings ever grazing each other.
const JUPITER_MOONS: MoonSpec[] = [
  { key: "io", to: "/sp500-map", ko: "이오", en: "Io", offsetPx: 0, durationSeconds: 14, phase: 0, kind: "galilean", skin: IO_SKIN, sizeUnits: MOON_UNIT * 0.5, gapUnits: 1.5 },
  { key: "europa", to: "/sp500-map", ko: "유로파", en: "Europa", offsetPx: 0, durationSeconds: 24, phase: 0.35, kind: "galilean", skin: EUROPA_SKIN, sizeUnits: MOON_UNIT * 1, gapUnits: 25 },
  { key: "ganymede", to: "/sp500-map", ko: "가니메데", en: "Ganymede", offsetPx: 0, durationSeconds: 40, phase: 0.6, kind: "galilean", skin: GANYMEDE_SKIN, sizeUnits: MOON_UNIT * 1.5, gapUnits: 63.5 },
  { key: "callisto", to: "/sp500-map", ko: "칼리스토", en: "Callisto", offsetPx: 0, durationSeconds: 58, phase: 0.85, kind: "galilean", skin: CALLISTO_SKIN, sizeUnits: MOON_UNIT * 0.6, gapUnits: 96 },
];

// Saturn's three — real NASA/JPL (Mimas) and USGS Astrogeology Cassini-
// mission mosaics (Enceladus, Titan), same public-domain pipeline as
// JUPITER_MOONS' four above. Titan's real photographed colour actually is
// this hazy orange-tan (its thick nitrogen/methane atmosphere scatters like
// this to a camera, the same way Jupiter's own banding is real and not a
// stylistic tint) rather than a neutral grey the way Mimas/Enceladus's icy
// surfaces are.
const MIMAS_SKIN: PhotoSkin = { texture: "/img/planets/mimas.webp", spinSeconds: 6, glow: "#d8d2c4" };
const ENCELADUS_SKIN: PhotoSkin = { texture: "/img/planets/enceladus.webp", spinSeconds: 8, glow: "#eaf4ff" };
const TITAN_SKIN: PhotoSkin = { texture: "/img/planets/titan.webp", spinSeconds: 13, glow: "#e8a35c" };

// Real closest-to-farthest order — Mimas, Enceladus, then Titan much further
// out (Titan is Saturn's largest moon by far, hence sizeUnits MOON_UNIT * 2
// against the other two's MOON_UNIT * 0.5 each — an explicit request).
// gapUnits follows the exact same "1.5 base, then clear each pair's combined
// half-sizes plus ~1 unit" recipe JUPITER_MOONS' own comment above works
// through, so these three sit just as tightly against Saturn without any of
// them ever grazing each other.
const SATURN_MOONS: MoonSpec[] = [
  { key: "mimas", to: "/ai-prediction", ko: "미마스", en: "Mimas", offsetPx: 0, durationSeconds: 16, phase: 0.1, kind: "galilean", skin: MIMAS_SKIN, sizeUnits: MOON_UNIT * 0.5, gapUnits: 1.5 },
  { key: "enceladus", to: "/ai-prediction", ko: "엔셀라두스", en: "Enceladus", offsetPx: 0, durationSeconds: 22, phase: 0.5, kind: "galilean", skin: ENCELADUS_SKIN, sizeUnits: MOON_UNIT * 0.5, gapUnits: 17.5 },
  { key: "titan", to: "/ai-prediction", ko: "타이탄", en: "Titan", offsetPx: 0, durationSeconds: 50, phase: 0.8, kind: "galilean", skin: TITAN_SKIN, sizeUnits: MOON_UNIT * 2, gapUnits: 56 },
];

// Io's own real feature, not decoration for its own sake: it's the most
// volcanically active body in the solar system, driven by exactly the
// tidal flexing its tight orbit around Jupiter (and its Laplace resonance
// with Europa/Ganymede) produces — real plumes (Pele, Loki, Tvashtar...)
// throw material hundreds of km above the surface, easily high enough to
// reach space. One fixed vent (an explicit request — three read as too busy
// at Io's own tiny render size) firing its own long ejecta streak (angle +
// full-length --flen, grown via scaleX — see .hb-io-flare/hb-io-eruption in
// hub.css). Long enough to visibly scatter out toward Jupiter's own edge,
// not just a puff at Io's own tiny surface — an explicit request. Flat px,
// not --body-unit-scaled — Io's own render box is already only ~12-40px
// depending on viewport scale, so scaling this the way the moon's own size
// does would shrink it to nothing at the small end.
const IO_VENTS = [
  { top: "58%", left: "72%", angle: -35, len: 32, dur: 3.1, delay: -1.4 },
] as const;

function IoVolcanoes() {
  return (
    <span className="hb-io-volcanoes" aria-hidden="true">
      {IO_VENTS.map((v, i) => (
        <span
          key={i}
          className="hb-io-flare"
          style={{
            top: v.top,
            left: v.left,
            "--fang": `${v.angle}deg`,
            "--flen": `${v.len}px`,
            animationDuration: `${v.dur}s`,
            animationDelay: `${v.delay}s`,
          } as React.CSSProperties}
        />
      ))}
    </span>
  );
}

// Enceladus's own real feature: Cassini flew straight through its south-
// polar plume and confirmed it's real liquid water venting from the
// subsurface ocean beneath the ice — the single most famous "erupting moon"
// in the solar system, and unlike Europa's own candidate detections, not
// speculative. Same growing-streak rig as Io's volcano above rather than
// discrete droplets (an explicit request — a single icy-white plume reads as
// vapour/smoke the way Io's does as fire), just one vent at the south pole,
// where the real "tiger stripe" fractures are (visible in enceladus.webp
// itself), aimed outward from it.
const ENCELADUS_VENTS = [
  { top: "88%", left: "50%", angle: 95, len: 30, dur: 3.4, delay: 0 },
] as const;

function EnceladusFountain() {
  return (
    <span className="hb-enceladus-fountain" aria-hidden="true">
      {ENCELADUS_VENTS.map((v, i) => (
        <span
          key={i}
          className="hb-enceladus-flare"
          style={{
            top: v.top,
            left: v.left,
            "--fang": `${v.angle}deg`,
            "--flen": `${v.len}px`,
            animationDuration: `${v.dur}s`,
            animationDelay: `${v.delay}s`,
          } as React.CSSProperties}
        />
      ))}
    </span>
  );
}

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
              <StarshipCraft />
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

  // Jupiter's and Saturn's real-textured moons (JUPITER_MOONS/SATURN_MOONS).
  // Same equatorial-ellipse rig as the Moon above, just parametrised: --rgap/
  // --rsize (spec.gapUnits/sizeUnits) stand in for hb-earth-moon-arm's
  // hardcoded "1.5" and hb-moon--lunar's hardcoded "/3", since each of these
  // needs its own ring radius and its own size ratio to the real Moon rather
  // than a single fixed one. --eq-squash is opened up a little past the
  // Moon's own 0.1 (flatter still would read as a single line at several
  // different radii).
  //
  // --eq-offset-y is NOT 0 despite wanting the ellipse dead-centred on the
  // host planet (no Earth-style downward push) — .hb-billboard has no
  // explicit height, so the planet button's own centring margin (top: -half
  // its own size) collapses through it, and an absolutely positioned
  // sibling's `top: 0` (.hb-ring-moons) ends up pinned to the planet's
  // rendered TOP EDGE, not its centre. This pushes the whole ring system up
  // by exactly half the host planet's own height — invisible for the small
  // stock-badge circles, but exactly why Jupiter's moons first read as
  // orbiting a point above Jupiter instead of Jupiter itself, before this
  // fix. Adding that same half-height back here cancels it out for whichever
  // planet this is nested inside; --size below is that host's own, the same
  // host planet size hb-ring-moon-arm's translateX already reads out
  // horizontally.
  if (spec.kind === "galilean") {
    const jStyle = {
      ...style,
      "--rgap": String(spec.gapUnits),
      "--rsize": String(spec.sizeUnits),
      "--eq-squash": 0.16,
      "--eq-offset-y": "calc(var(--size) * var(--body-unit) / 2)",
    } as React.CSSProperties;
    // Io's own tooltip names the eruption, not just the moon — an explicit
    // request, and reasonable given IoVolcanoes right below is rendering
    // that same eruption. Every other moon here just gets its own name.
    const hoverLabel = spec.key === "io" ? `${label}-화산분출중` : label;
    return (
      <div className="hb-moon-orbiter hb-moon-orbiter--equatorial" style={jStyle}>
        <div className="hb-moon-depth">
          <div className="hb-ring-moon-arm">
            <div className="hb-moon-face hb-moon-face--equatorial">
              <button
                type="button"
                className="hb-moon hb-moon--realmoon"
                onClick={() => onOpen(spec.to)}
                aria-label={`${en ? "Moon" : "위성"}: ${hoverLabel}`}
                title={hoverLabel}
              >
                <PhotoPlanetBody id={spec.key} skin={spec.skin!} />
                {spec.key === "io" && <IoVolcanoes />}
                {spec.key === "enceladus" && <EnceladusFountain />}
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
            {(spec.key === "jupiter" || spec.key === "saturn") && (
              // Desktop-only (see .hb-ring-moons in hub.css) — an explicit
              // request, unlike Earth's/Mars's moons above which still show
              // (shrunk) on mobile.
              <div className="hb-ring-moons">
                {(spec.key === "jupiter" ? JUPITER_MOONS : SATURN_MOONS).map((moon) => (
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
 * neither can start a frame ahead of the other.
 *
 * --origin/--ox/--oy are written here from the binary button's actual
 * getBoundingClientRect() rather than left at hub.css's hand-picked fallback
 * percentages: the button is positioned with a px/vw clamp() (see
 * .hb-neutron-binary), which doesn't scale as a fixed viewport percentage,
 * so a static "90% 13%" only lined up with the real merge point at the one
 * viewport size it was eyeballed against and drifted toward the corner
 * everywhere else — which read as the explosion starting up and to the
 * right of the star instead of centred on it. Both stars and the merged
 * remnant hang off this same button's 50%/50% centre (see its own comment),
 * so the button's own rect centre *is* the merge point. */
function fireMergerBurst(
  originRef: React.RefObject<HTMLButtonElement>,
  flashRef: React.RefObject<HTMLDivElement>,
  novaRef: React.RefObject<HTMLDivElement>
) {
  const origin = originRef.current;
  let xPct = 90;
  let yPct = 13;
  if (origin) {
    const rect = origin.getBoundingClientRect();
    xPct = ((rect.left + rect.width / 2) / window.innerWidth) * 100;
    yPct = ((rect.top + rect.height / 2) / window.innerHeight) * 100;
  }

  const flash = flashRef.current;
  if (flash) {
    flash.style.setProperty("--origin", `${xPct}% ${yPct}%`);
    flash.classList.remove("is-flashing");
    void flash.offsetWidth;
    flash.classList.add("is-flashing");
  }
  const nova = novaRef.current;
  if (nova) {
    nova.style.setProperty("--ox", `${xPct}%`);
    nova.style.setProperty("--oy", `${yPct}%`);
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
          fireMergerBurst(ref, flashRef, novaRef);
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
// How long the Pluto half of the feeding cycle lasts. NOT the loop's own
// period any more — the blue-star event below runs immediately after this
// finishes and the two share one repeat (see HB_FEED_CYCLE), so this is now
// just the boundary between the two halves.
const PLUTO_CYCLE = PLUTO_MOTION + PLUTO_FLASH_HOLD;

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
      // Modulo the FULL feeding cycle, not just PLUTO_CYCLE: the blue-star
      // event owns the stretch from PLUTO_CYCLE to HB_FEED_CYCLE, and for all
      // of it every branch below lands on its own "already consumed" side —
      // gap pinned at 0, the destroy window long past, the body held hidden —
      // which is exactly the resting state Pluto should be in while the star
      // is being eaten. No extra gating needed, just the longer period.
      const cycleElapsed = elapsed % HB_FEED_CYCLE;

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

/* ─────────────────────────── blue star event ───────────────────────────
   The second half of the black hole's feeding cycle, picking up the instant
   the Pluto event above finishes: a blue star at 60% of the sun's own size,
   parked 400px to the hole's left, spends twenty seconds spilling blue gas
   off its hole-facing (right) limb into the horizon, then loses cohesion
   altogether and drains in as one cloud, and the hole glows blue — steadily
   brightening — for three seconds as it swallows the last of it. Then the
   whole thing resets to Pluto and the pair repeats. Every one of those
   numbers is from an explicit request.

   The visual language is the one every documentary animation of a star being
   eaten uses, which the request asked to be matched: the gas does not fall
   straight in. It leaves the inner limb as a tidal stream, arcs off the
   direct line, and winds a lap or two around the hole — accelerating and
   tightening the whole way — before crossing the horizon. gasPoint below is
   that path.

   Shares the Pluto event's clock through HB_FEED_CYCLE and its real-pixel
   geometry, and is built the same way: one rAF loop and no CSS keyframes,
   because the star's tidal distortion, the stream, the debris cloud and the
   hole's own glow all have to read one clock rather than drift apart on
   independent timers. */

// px, from the black hole's CENTRE to the star's centre — the same
// centre-to-centre convention --pluto-gap uses, and the same reason (see
// .hb-bluestar-event in hub.css for the centre-to-edge translation). Unlike
// Pluto's, this distance never changes: the star is held at arm's length and
// eaten where it stands, so nothing here writes a per-frame position for it.
//
// Handed to CSS as `--bluestar-gap` on both of the event's layers (see where
// they are rendered below) rather than written down a second time in the
// stylesheet. Two elements in two separate subtrees are positioned off this
// number — the star's own box, and the stream bridge spanning it to the hole —
// and the Pluto event above is the cautionary case: its own 300 lives in both
// files, so retuning it means remembering to find both.
const STAR_GAP = 400;

const STAR_STREAM_LEN = 20; // seconds of right-limb streaming
const STAR_COLLAPSE_LEN = 6; // then the whole body comes apart and drains
const STAR_FLARE_LEN = 3; // then the hole's blue glow, brightening throughout
/** Seconds the blue glow takes to fade once the cycle has already handed back
 * to Pluto. Deliberately outside STAR_CYCLE: the request's three seconds are
 * three seconds of BRIGHTENING, so the release cannot be carved out of them —
 * see where this is used in useBlueStarEvent. */
const STAR_HALO_TAIL = 0.8;
const STAR_COLLAPSE_START = STAR_STREAM_LEN;
const STAR_COLLAPSE_END = STAR_STREAM_LEN + STAR_COLLAPSE_LEN;
const STAR_CYCLE = STAR_COLLAPSE_END + STAR_FLARE_LEN; // 29s

/** The full feeding cycle both events share: Pluto's fifteen seconds, then the
 * blue star's twenty-nine, then back to Pluto. Both loops modulo this one
 * number so neither can drift out of phase with the other. */
const HB_FEED_CYCLE = PLUTO_CYCLE + STAR_CYCLE; // 44s

/** How far the star stretches toward the hole under tidal strain. Two
 * regimes, deliberately far apart in scale: a barely-there 1.22x over the
 * whole twenty-second stream (a star losing its outer envelope is distorted,
 * not destroyed — overdoing it here leaves nothing for the collapse to do),
 * then a hard 3.4x more once cohesion actually goes. Applied with
 * `transform-origin: 0% 50%` (see .hb-bluestar-body in hub.css) so the
 * stretch reaches out to the right, into the hole. */
const STAR_STREAM_STRETCH = 0.22;
const STAR_COLLAPSE_STRETCH = 3.4;

/** The star's own infall path, once it lets go. It travels the SAME kind of
 * curve its gas does — gasPoint, with its own bow and turns — rather than
 * sliding straight at the hole, which is what it did before and what an
 * explicit request called out: nothing falls radially into a black hole, and a
 * body that does reads as being dragged on a wire next to gas that is visibly
 * spiralling. Just under a lap, so the winding is unmistakable without the star
 * lapping the hole and crossing back over its own stream. */
const STAR_FALL_BOW = 46;
const STAR_FALL_TURNS = 0.82;

/** How far the star creeps toward the hole across the twenty seconds it spends
 * being stripped, px. It used to hold its parked distance perfectly for all of
 * them, which left the first two thirds of the event with a completely static
 * body — an explicit request asked for it to be drawn in "조금씩", little by
 * little, as its gas goes, and a follow-up for more of it. The spiral below
 * picks up from wherever this leaves it, so the two are continuous.
 *
 * The ceiling on this is the star's own leading edge reaching the accretion
 * disc before the fall has even started. At 105 it ends the stream 295px out,
 * putting that edge ~59px clear of the disc's rim — close enough to look
 * committed, with the plunge still ahead of it. */
const STAR_DRIFT = 105;

/** One heat-haze wisp on the star's rim — see buildBlueStarHaze below and
 * .hb-bluestar-wisp/-halo in hub.css for the rendering. Positioned and sized
 * once at module load; nothing here is touched per frame, and nothing it
 * renders as carries a filter or blend mode — see the long note on
 * `.hb-bluestar-wisp` in hub.css for why those, not the element count, were
 * the actual cost in the pass before this one. */
interface HazeWisp {
  left: number; // %, box-relative
  top: number; // %, box-relative
  size: number; // %, box-relative — this is the wisp's WIDTH; height is a
  // fixed multiple of it in CSS, so only one number has to be generated here.
  rot: number; // deg — see the function's own comment for where +90 comes from
  duration: number; // s
  delay: number; // s, negative — mid-cycle on mount, not launched in lockstep
  pull: boolean; // drawn out toward the hole rather than just shimmering in place
  pullDist: number; // % of the wisp's own box, negative (outward) — only meaningful if pull
}

/** The star's rim, as a field of small independently-timed heat-haze wisps —
 * 아지랑이, the request's own word for it: the fine, dense, fast waver off a
 * hot surface, not a few big licks. Two earlier passes both drew this as a
 * handful of bigger shapes (first one masked conic-gradient ring, then
 * eighteen flame "licks" — see the git history on this block and the long
 * note on `.hb-bluestar-halo` in hub.css) and both read as a shape doing
 * something, blinking or bulging, rather than as a texture. More, thinner,
 * faster-moving elements is what a shimmer actually needs, and it is also
 * the cheaper shape to render: a sliver has less ink than a blob, and none of
 * these carry a filter or blend mode at all (again, see hub.css).
 *
 * `angle` walks the full circle in the same convention `Math.cos`/`sin` give
 * for free: 0 is due right, which is already "toward the hole" — the same
 * "local right = toward the hole" rule `.hb-bluestar-body.is-eaten`'s mask
 * and `.hb-bluestar-limb`'s own gradient both rely on — so no separate
 * heading has to be threaded in here, even once the body starts rotating
 * into its own infall spiral near the end of the event. `rot` is that same
 * angle turned into a CSS rotation for the wisp's own shape: a wisp is drawn
 * tall and narrow, tip at its own local top, so an unrotated one points due
 * north (270° in this file's clockwise-from-east convention) — rotating it
 * by `angle + 90` is what turns "north" into "pointing along `angle`", i.e.
 * outward from the star's centre at exactly the spot it sits on the rim.
 * Wisps that land within ~55° of the hole-facing direction are marked `pull`:
 * drawn out and dragged toward it, versus the rest of the rim just
 * shimmering in place.
 *
 * Deterministic PRNG so the pattern is fixed across renders — see this
 * file's own `mulberry32` above and the same reasoning everywhere else it is
 * used on this page: reshuffling on mount would read as the whole rim's
 * structure jumping to a different shape. */
function buildBlueStarHaze(count: number, seed: number): HazeWisp[] {
  const rand = mulberry32(seed);
  const wisps: HazeWisp[] = [];
  const facingRad = (55 * Math.PI) / 180;
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + (rand() - 0.5) * ((Math.PI * 2) / count) * 0.8;
    const angleFromRight = angle > Math.PI ? angle - Math.PI * 2 : angle;
    const pull = Math.abs(angleFromRight) < facingRad;
    const size = 6 + rand() * 7 + (pull ? rand() * 2 : 0);
    wisps.push({
      left: 50 + Math.cos(angle) * 50,
      top: 50 + Math.sin(angle) * 50,
      size,
      rot: (angle * 180) / Math.PI + 90,
      duration: pull ? 1.7 + rand() * 1.3 : 0.9 + rand() * 1.1,
      delay: -rand() * 3,
      pull,
      pullDist: -(160 + rand() * 110),
    });
  }
  return wisps;
}

// Twenty-six thin wisps, not the fourteen chunky licks the pass before this
// used — each one is a sliver with no filter/blend on it (see hb-bluestar-wisp
// in hub.css), so more of them is what actually reads as a dense shimmer
// rather than a countable few shapes, for LESS total ink than fourteen much
// bigger blobs were drawing.
const BLUESTAR_FLAME = buildBlueStarHaze(26, 20260801);

/* ── the gas, on a canvas ───────────────────────────────────────────────
   This started as ~50 absolutely-positioned <span>s, each carrying a
   radial-gradient background and taking a transform and an opacity every
   frame. That reads as a countable spray of dots, not as gas, and there is no
   way to fix it by adding more of them: every extra mote is another composited
   layer and another pair of style writes, and the Pluto event above already
   documents where that ceiling is (a 212-piece version of it measurably
   dropped frames, and it was cut back to 40).

   One <canvas> lifts the ceiling by two orders of magnitude, because the cost
   stops being per-ELEMENT and becomes per-PIXEL. 1,800 particles is one draw
   loop over a typed array, blitting a pre-rendered sprite — no DOM, no style
   recalc, no compositing, nothing for the browser to lay out. Three things
   make it cheap enough to be a net WIN over the 50 spans it replaces:

     · The backing store is 0.62x the CSS size. For crisp art that would be
       unacceptable; for a soft additive glow the upscale is free blur, and it
       cuts fill rate — the only thing that actually costs here — by ~60%.
       devicePixelRatio is deliberately ignored for the same reason.
     · The canvas covers only the corridor the gas can reach, not the
       viewport, and is anchored so the rest is clipped by the screen edge.
     · Each frame FADES the previous one instead of clearing it
       (`destination-out` at low alpha). Every particle therefore leaves a
       streak, which is both what makes a stream of discrete points read as
       continuous flowing filaments and a ~5-10x multiplier on apparent
       density for no extra particles.

   `lighter` (additive) blending is what makes it look like gas rather than
   paint: where the stream is dense the contributions pile up past white and
   the ribbon's core burns out, exactly as it does in the tidal-disruption
   footage this is modelled on, and it happens on its own from the overlap
   rather than needing a second brightness pass. */

/** Particle fields, packed into one Float32Array. A flat buffer rather than an
 * array of objects because this loop touches every field of every particle
 * sixty times a second: the typed array keeps them contiguous, and — more to
 * the point — nothing in here is ever allocated after startup, so a scene that
 * runs for twenty seconds at a time never hands the collector a reason to
 * pause mid-stream. */
const P_STRIDE = 11;
const P_PHASE = 0; // 0..1 offset into its own recycling loop
const P_SPEED = 1; // loops per second, i.e. 1 / lifetime
const P_ANGLE = 2; // release angle, radians — see P_RADIUS for what it is measured against
const P_RADIUS = 3; // release radius; units differ per pool, see buildGasParticles
const P_BOW = 4; // signed perpendicular offset, px, peaking mid-flight
const P_TURNS = 5; // laps around the hole before the horizon
const P_SIZE = 6; // rendered sprite size, px
const P_WOBA = 7; // transverse wobble amplitude, px — what gives the ribbon filaments
const P_WOBF = 8; // and its frequency, in cycles along the path
const P_BRIGHT = 9; // per-particle brightness multiplier
const P_SPRITE = 10; // which of the pre-rendered blobs to blit

/** Particles per tier, in three pools.
 *
 * `stream` feeds off the star's limb for the full twenty seconds and `collapse`
 * empties the body over the last six. `ring` is material already captured into
 * the accretion ring, circling close in — added because the winding part of the
 * spiral was the sparse part: a stream particle crosses that region quickly and
 * only a fraction of the pool is in it at any moment, so the ring read as a few
 * strands rather than as a ring.
 *
 * Sized so the winding region ends up with ~3x the particles it had — the
 * tripling the request asks for, bought where it is actually visible instead of
 * by tripling the whole field.
 *
 * Note this pool is comparable to the stream's rather than a multiple of it,
 * despite tripling that region's density, and the reason is worth writing down:
 * ring particles start at 0.14-0.76 of STAR_GAP, so ~85% of the pool is inside
 * the disc at any moment, against a low single-digit percentage of the
 * stream's. A first pass set this to 2x the stream pool on the assumption the
 * ratio would carry over; it landed at 5.6x density and 3,751 sprite blits a
 * frame. Density here is about where particles SPEND their time, not how many
 * there are. */
const GAS_COUNTS: Record<SceneTier, { stream: number; collapse: number; ring: number }> = {
  full: { stream: 1220, collapse: 580, ring: 1500 },
  lite: { stream: 610, collapse: 290, ring: 750 },
  minimal: { stream: 260, collapse: 120, ring: 320 },
};

/** Backing-store scale — see the note above on why this is below 1 and why
 * devicePixelRatio plays no part in it. Walked down from 0.62 to 0.52 to 0.46
 * as the ring was pushed to read as smoke: the upscale on the way to the screen
 * is a blur the GPU performs for free, which is the cheapest softening
 * available anywhere in this system, and it buys back fill for the much larger
 * haze blobs at the same time. Nothing on this canvas has an edge that needs
 * to survive — it is all soft glow — so the usual objection to rendering below
 * device resolution does not apply here.
 *
 * 0.4 is about as far as this should go. Past it the smallest stream particles
 * land on under two backing-store pixels, at which point they stop being
 * filaments and start being flicker. */
const GAS_RES = 0.4;

/** How far out from the hole's centre the canvas has to reach. A particle is
 * released at most (STAR_GAP + 1.34 star radii) out and only ever falls inward
 * from there, so this is that distance with room for the sprite's own width —
 * anything beyond it is off-screen anyway, since the hole sits in a corner.
 *
 * Handed to CSS as `--gas-reach`, for the same reason STAR_GAP is: the box this
 * sizes and the loop that assumes nothing escapes it have to agree, and they
 * cannot if the number is written down in two files. */
const GAS_REACH = 560;

const GAS_SPRITE_PX = 44;

/** The blobs the particles are drawn with, pre-rendered once. Several rather
 * than one: canvas2d has no cheap per-blit tint, so both colour and softness
 * variety have to come from having more than one sprite to choose from.
 *
 * 0-2 are the stream's: hot white for the compressed material near the horizon,
 * mid blue for the body of the stream, deep blue for its cooler edges. Under
 * additive blending these mix wherever they overlap, which is most places.
 *
 * 3 is HAZE, and it is a different kind of thing — the request asks for the
 * ring to read "거의 연기처럼", like fine smoke, and the instinct that gets that
 * wrong is to reach for more and smaller particles. Small bright points read as
 * sand or sparks no matter how many there are; what actually makes smoke is a
 * continuous field with no discernible grain, which comes from LARGE, very
 * FAINT blobs overlapping many deep. So this one has almost no core, a falloff
 * that is nearly linear all the way out, and a peak alpha a fifth of the
 * others'. It is cheap in exactly the way that matters too — the softness comes
 * from the sprite, not from more draw calls.
 *
 * Built lazily inside the effect rather than at module scope: this file is
 * imported during server-side rendering too, where `document` does not exist. */
function buildGasSprites(): HTMLCanvasElement[] {
  // Each entry: [core rgb, mid rgb, outer rgb, core alpha, mid stop, mid alpha]
  const ramps: [number[], number[], number[], number, number, number][] = [
    [[255, 255, 255], [200, 232, 255], [120, 190, 255], 1, 0.18, 0.62],
    [[225, 245, 255], [140, 200, 255], [70, 145, 250], 1, 0.18, 0.62],
    [[190, 225, 255], [95, 165, 250], [40, 100, 230], 1, 0.18, 0.62],
    // The haze. Flatter than a blob has any business being: a low peak, and
    // the mid stop pushed most of the way out at nearly the same alpha as the
    // centre, so the profile is close to a plateau with a long soft shoulder
    // rather than a peak. A blob with any real centre resolves as a dot the
    // moment it stops overlapping something, and that dot is the grain this is
    // trying not to have.
    [[210, 234, 255], [150, 198, 250], [80, 140, 235], 0.15, 0.7, 0.125],
  ];
  return ramps.map(([core, mid, outer, coreA, midStop, midA]) => {
    const c = document.createElement("canvas");
    c.width = GAS_SPRITE_PX;
    c.height = GAS_SPRITE_PX;
    const g = c.getContext("2d");
    if (!g) return c;
    const h = GAS_SPRITE_PX / 2;
    const grad = g.createRadialGradient(h, h, 0, h, h, h);
    // Reaches zero at the sprite's own edge, so the blobs have no visible
    // boundary to give themselves away as sprites.
    grad.addColorStop(0, `rgba(${core.join(",")},${coreA})`);
    grad.addColorStop(midStop, `rgba(${mid.join(",")},${midA})`);
    grad.addColorStop(1, `rgba(${outer.join(",")},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, GAS_SPRITE_PX, GAS_SPRITE_PX);
    return c;
  });
}

/** Pool boundaries within the packed buffer. The three pools are laid out
 * stream-then-collapse-then-ring, and the draw loop tells which is which purely
 * from a particle's index — cheaper than a per-particle kind field, which would
 * be a whole float carrying under two bits. */
interface GasPools {
  stream: number;
  collapse: number;
  ring: number;
}

function buildGasParticles(counts: GasPools): Float32Array {
  const rand = mulberry32(20260730);
  const total = counts.stream + counts.collapse + counts.ring;
  const buf = new Float32Array(total * P_STRIDE);
  for (let i = 0; i < total; i += 1) {
    const isStream = i < counts.stream;
    const isCollapse = !isStream && i < counts.stream + counts.collapse;
    const idx = isStream ? i : isCollapse ? i - counts.stream : i - counts.stream - counts.collapse;
    const n = isStream ? counts.stream : isCollapse ? counts.collapse : counts.ring;
    const o = i * P_STRIDE;
    // Evenly spread across the loop with only slight jitter. This is the one
    // place in this file where even spacing is wanted rather than avoided: a
    // gap in the cadence reads as the ribbon breaking, not as variation.
    buf[o + P_PHASE] = (idx / n + rand() * 0.02) % 1;
    buf[o + P_SPEED] = isStream
      ? 1 / (2.4 + rand() * 2.6)
      : isCollapse
        ? 1 / (1.3 + rand() * 1.5)
        : // Ring particles have a much shorter trip: they start already close
          // in, so the same speed would have them cross the whole ring in a
          // blink. Slower, so they visibly circle.
          1 / (1.9 + rand() * 2.8);
    /* What P_ANGLE and P_RADIUS mean depends on the pool, because the three
       are released from three different places:

         stream   angle around the star's HOLE-FACING hemisphere only (the
                  request is about gas leaving its right side, so this never
                  reaches round to the far limb); radius as a multiple of the
                  star's own, just above 1 so the gas comes from OUTSIDE the
                  photosphere — "행성외부의 가스" — rather than looking scraped
                  off a surface.
         collapse angle anywhere in the star's disc, radius a fraction of it:
                  by then the body is coming apart from the inside.
         ring     angle anywhere around the HOLE, radius a fraction of
                  STAR_GAP — i.e. already captured, already circling. */
    buf[o + P_ANGLE] = isStream
      ? (-72 + rand() * 144) * (Math.PI / 180)
      : rand() * Math.PI * 2;
    buf[o + P_RADIUS] = isStream ? 1 + rand() * 0.34 : isCollapse ? rand() * 0.95 : 0.14 + rand() * rand() * 0.62;
    buf[o + P_BOW] =
      (rand() < 0.5 ? -1 : 1) * (isStream ? 14 + rand() * 78 : isCollapse ? 8 + rand() * 52 : 4 + rand() * 22);
    // Ring particles wind hardest — several laps each, which is the whole
    // reason they exist.
    buf[o + P_TURNS] = isStream ? 0.7 + rand() * 1.35 : isCollapse ? 1 + rand() * 1.7 : 1.6 + rand() * 3;
    /* For the two star-fed pools: small, with a wide spread of small (rand()
       squared biases hard toward the low end), so density comes from the count
       and the additive pile-up rather than from each blob being large, with a
       few bigger ones carrying the soft body of the cloud.
       The ring's go the OTHER way — deliberately large. Smoke has no grain, and
       grain is exactly what small particles give you however many you use; a
       continuous field needs blobs wide enough to overlap many deep. Paired
       with the haze sprite and the very low brightness below, that is what
       turns this from a swarm of dots into shading. */
    /* The floor is set by GAS_RES, not by taste. A sprite drawn onto fewer than
       ~2 backing-store pixels cannot hold still between frames — it shimmers as
       it moves, which is the exact opposite of the fine, even medium this is
       for. At GAS_RES 0.4, and allowing for the (1 - 0.5 * local) shrink a
       particle has already taken by the time it fades out, that floor is ~9px.
       A 5px floor here put the smallest stream particles on 1.1 backing pixels. */
    buf[o + P_SIZE] = (isStream ? 9 : isCollapse ? 9 : 15) + rand() * rand() * (isStream ? 24 : isCollapse ? 30 : 58);
    buf[o + P_WOBA] = rand() * (isStream ? 15 : 8);
    buf[o + P_WOBF] = 1 + rand() * 3.5;
    /* The ring's own particles run far dimmer than the two star-fed pools. They
       sit much more densely packed than either (see GAS_COUNTS) and they are far
       larger, and under additive blending density IS brightness — at the
       stream's levels the ring clipped to a flat white disc and threw away the
       structure the extra particles were added to produce. Faint enough that
       only the pile-up is visible is the whole trick behind the smoke read.
       Coverage — how many haze blobs deep a given pixel sits — is the knob that
       controls BOTH of the things this pool gets asked for, which is why they
       move together. Grain disappears as coverage rises, and since additive
       blending sums what overlaps, per-pixel brightness rises with it. So "너무
       희미함" and "알갱이가 보임" have the same fix, and the sizes above carry it:
       ~3.5x the disc's area went to ~6.5x. The alpha here then only has to make
       up the difference between the brightness that bought and the brightness
       wanted, which is why it moves so much less than the area did.

       Doing the same with PARTICLE COUNT instead would have cost ~400 more
       sprite blits a frame for an identical result — area is free, count is
       not. */
    buf[o + P_BRIGHT] = (isStream || isCollapse ? 0.45 : 0.07) + rand() * (isStream || isCollapse ? 0.55 : 0.16);
    /* Stream and collapse pick from the three coloured blobs; the ring is mostly
       haze (sprite 3) with a scattering of the cooler coloured ones through it,
       so it keeps some hue variation instead of going uniformly grey-blue. */
    buf[o + P_SPRITE] = isStream || isCollapse ? Math.min(2, Math.floor(rand() * 3)) : rand() < 0.82 ? 3 : 1 + Math.floor(rand() * 2);
  }
  return buf;
}

interface StarGeometry {
  bhCenterX: number;
  bhCenterY: number;
  starCenterX: number;
  starCenterY: number;
  starRadius: number;
}

function measureStarGeometry(bhEl: HTMLElement, starEl: HTMLElement): StarGeometry {
  const bh = bhEl.getBoundingClientRect();
  const star = starEl.getBoundingClientRect();
  return {
    bhCenterX: bh.left + bh.width / 2,
    bhCenterY: bh.top + bh.height / 2,
    starCenterX: star.left + star.width / 2,
    starCenterY: star.top + star.height / 2,
    // The star is a stack of CSS gradients filling its whole box (see
    // .hb-bluestar-body in hub.css), not an SVG inset inside a padded viewBox
    // the way PhotoPlanetBody is — so this is a plain half-width, with no
    // BASE_R/100 factor of the kind measurePlutoGeometry's caller needs.
    starRadius: star.width / 2,
  };
}

/** Scratch output for gasPoint. A single shared object, mutated in place: the
 * draw loop calls that function 1,800 times a frame, and returning a fresh
 * `{x, y}` from each call would hand the collector ~108,000 short-lived
 * objects a second — the one thing an animation that has to hold 60fps for
 * twenty seconds straight cannot afford. */
const gasOut = { x: 0, y: 0 };

/** Writes where one gas particle sits, in screen px, at local progress t — 0
 * the instant it is released from (x0, y0), 1 as it crosses the horizon — into
 * `gasOut`.
 *
 * Worked in POLAR coordinates about the hole, which is what makes this read
 * like an accretion stream rather than a straight line with a curve drawn on
 * it. The radius decays as a power of the time remaining and the angle winds
 * up as a power of the time elapsed, both with exponents above 1: early on the
 * particle is still mostly falling and barely turning, and by the end it is
 * barely falling and turning very fast. That asymmetry — the visible
 * tightening into a ring — is the whole effect, and it falls out of the
 * exponents rather than needing a hand-authored path.
 *
 * Two transverse displacements are then added along the local normal, both of
 * which vanish at t=0 and t=1 so neither can pull a particle off the star it
 * left or the hole it falls into:
 *
 *   · `bow`, one half-cycle over the whole trip, which bends the path off the
 *     direct line so the stream arrives tangentially and has real width
 *     instead of being one taut wire.
 *   · `wobA`/`wobF`, several cycles over the trip, which is what breaks the
 *     ribbon into FILAMENTS. Neighbouring particles are given different
 *     frequencies, so they weave past each other instead of travelling as one
 *     smooth tube — the internal structure the request is asking for when it
 *     wants the ring more detailed. Damped by (1-t) on top of its own envelope,
 *     since the closer material is to the horizon the more the shear has
 *     already combed it straight. */
function gasPoint(
  geo: StarGeometry,
  x0: number,
  y0: number,
  bow: number,
  turns: number,
  wobA: number,
  wobF: number,
  t: number
): void {
  const r0 = Math.hypot(x0 - geo.bhCenterX, y0 - geo.bhCenterY);
  const theta0 = Math.atan2(y0 - geo.bhCenterY, x0 - geo.bhCenterX);
  const r = r0 * Math.pow(1 - t, 1.25);
  const theta = theta0 + turns * Math.PI * 2 * Math.pow(t, 1.7);
  const envelope = Math.sin(Math.PI * t);
  const off = bow * envelope + wobA * envelope * (1 - t) * Math.sin(wobF * Math.PI * 2 * t);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  gasOut.x = geo.bhCenterX + r * ct - off * st;
  gasOut.y = geo.bhCenterY + r * st + off * ct;
}

function useBlueStarEvent(
  eventRef: React.RefObject<HTMLDivElement>,
  bodyRef: React.RefObject<HTMLDivElement>,
  limbRef: React.RefObject<HTMLSpanElement>,
  coronaRef: React.RefObject<HTMLSpanElement>,
  streamRef: React.RefObject<HTMLSpanElement>,
  haloRef: React.RefObject<HTMLSpanElement>,
  recolorRef: React.RefObject<HTMLSpanElement>,
  canvasRef: React.RefObject<HTMLCanvasElement>,
  particles: Float32Array,
  /** The same pool sizes the buffer was built from — the draw loop needs them
   * to tell which of the three a given particle index belongs to. */
  counts: GasPools,
  blackHoleRef: React.RefObject<HTMLButtonElement>
) {
  useEffect(() => {
    const eventEl = eventRef.current;
    const bhEl = blackHoleRef.current;
    if (!eventEl || !bhEl) return;
    // Same bail-out as usePlutoEvent: no loop at all, and hub.css hides the
    // whole layer, so there is no resting frame to draw either.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d") ?? null;
    const sprites = ctx ? buildGasSprites() : [];

    let geo = measureStarGeometry(bhEl, eventEl);
    // The canvas's own top-left in screen coordinates. Every particle position
    // is computed against the hole's real on-screen centre, so each one has to
    // be shifted into the canvas's own space before it can be drawn.
    let originX = 0;
    let originY = 0;
    // CSS px, i.e. the size the fade rect has to cover. The backing store is
    // GAS_RES times this, and the context carries a matching scale.
    let cssW = 0;
    let cssH = 0;

    const sizeCanvas = () => {
      if (!canvas || !ctx) return;
      const r = canvas.getBoundingClientRect();
      originX = r.left;
      originY = r.top;
      cssW = r.width;
      cssH = r.height;
      canvas.width = Math.max(1, Math.round(r.width * GAS_RES));
      canvas.height = Math.max(1, Math.round(r.height * GAS_RES));
      // Set once per resize, so the whole draw loop below can work in plain CSS
      // pixels and stay unaware that the backing store is smaller.
      ctx.setTransform(GAS_RES, 0, 0, GAS_RES, 0, 0);
    };
    sizeCanvas();

    const onResize = () => {
      geo = measureStarGeometry(bhEl, eventEl);
      sizeCanvas();
    };
    window.addEventListener("resize", onResize);

    let raf = 0;
    const startedAt = performance.now();
    // Whether the star's half of the cycle was running as of the previous
    // frame. Everything this loop touches is reset exactly once on the way
    // out rather than re-written every frame through Pluto's fifteen seconds.
    let wasActive = false;
    let wasFlaring = false;
    let wasCollapsing = false;

    const rest = () => {
      // The event box carries the star's spiral travel, so it has to come back
      // to its parked position too — otherwise the next cycle's star faded in
      // wherever the last one was swallowed.
      eventEl.style.transform = "";
      const body = bodyRef.current;
      if (body) {
        body.style.opacity = "0";
        body.style.transform = "";
        // Back to whole, so the next cycle's star does not fade in already
        // half-eaten from the last one.
        body.classList.remove("is-eaten");
        body.style.removeProperty("--eat-keep");
      }
      if (limbRef.current) limbRef.current.style.opacity = "0";
      if (coronaRef.current) coronaRef.current.style.opacity = "0";
      if (streamRef.current) {
        streamRef.current.style.opacity = "0";
        streamRef.current.style.transform = "";
      }
      if (haloRef.current) haloRef.current.style.opacity = "0";
      if (recolorRef.current) recolorRef.current.style.opacity = "0";
      // A hard clear, not a fade: the trail technique below means the canvas is
      // never empty of its own accord, so without this the last frame's streaks
      // would still be sitting there through all fifteen seconds of Pluto.
      if (ctx) {
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, cssW, cssH);
      }
      blackHoleRef.current?.classList.remove("is-feeding-blue");
    };

    const tick = (now: number) => {
      const cycleElapsed = ((now - startedAt) / 1000) % HB_FEED_CYCLE;
      // Negative for the whole Pluto half — this loop's own clock, zeroed at
      // the moment the star's phase begins.
      const t = cycleElapsed - PLUTO_CYCLE;

      if (t < 0) {
        if (wasActive) {
          rest();
          wasActive = false;
          wasFlaring = false;
          wasCollapsing = false;
        }
        /* The blue glow reaches its brightest at the exact instant the cycle
           hands back to Pluto — the flare's three seconds are the last three
           of the star's phase — so without this it would be cut from full
           brightness to nothing in a single frame. It gets a short tail on the
           far side of the wrap instead. Nothing else in this layer needs one:
           the star itself has been gone since the collapse ended, and rest()
           above has already put the stream and every mote away.

           Written here rather than as a CSS transition on the element because
           its opacity is set every frame while the event runs — a transition
           would sit on all of those writes too and turn the request's own
           three-second ramp into a laggy approximation of one. */
        if (cycleElapsed < STAR_HALO_TAIL + 0.2) {
          const el = haloRef.current;
          if (el) el.style.opacity = Math.max(0, 1 - cycleElapsed / STAR_HALO_TAIL).toFixed(3);
        }
        raf = requestAnimationFrame(tick);
        return;
      }
      wasActive = true;

      const streaming = t < STAR_COLLAPSE_START;
      const collapsing = t >= STAR_COLLAPSE_START && t < STAR_COLLAPSE_END;
      const flaring = t >= STAR_COLLAPSE_END;
      // 0 through the stream, 0..1 across the collapse, 1 once it's over.
      const cp = Math.min(1, Math.max(0, (t - STAR_COLLAPSE_START) / STAR_COLLAPSE_LEN));
      // 0..1 across the closing blue flare.
      const fp = Math.min(1, Math.max(0, (t - STAR_COLLAPSE_END) / STAR_FLARE_LEN));
      // 0..1 across the stream, held at 1 afterwards.
      const sp = Math.min(1, t / STAR_STREAM_LEN);

      // The star arrives rather than blinking into existence: without this it
      // popped in at full brightness the instant Pluto's flash ended, which
      // read as a rendering glitch rather than as a body drifting into frame.
      const arrive = Math.min(1, t / 1.2);

      /* Where the star is THIS frame, and which way it is heading.
         For the twenty seconds of the stream it holds its parked position. Once
         it lets go it rides gasPoint — the same curve its own gas takes — so it
         spirals in rather than sliding straight at the hole, per an explicit
         request ("고리 감기는 입자의 방향으로 없어지게"). `heading` is taken by
         sampling the path a hair further along and pointing at the difference,
         which is cheaper and steadier than differentiating the curve by hand. */
      // Where the fall begins: the parked spot plus whatever the drift below has
      // already closed. Both the drift and the spiral measure from here, which
      // is what keeps the handover between them seamless — the spiral's own
      // starting radius is this point's, not the parked one's.
      const fallFromX = geo.starCenterX + STAR_DRIFT;
      let starNowX = geo.starCenterX + sp * STAR_DRIFT;
      let starNowY = geo.starCenterY;
      let heading = 0;
      if (cp > 0) {
        gasPoint(geo, fallFromX, geo.starCenterY, STAR_FALL_BOW, STAR_FALL_TURNS, 0, 0, cp);
        starNowX = gasOut.x;
        starNowY = gasOut.y;
        gasPoint(
          geo,
          fallFromX,
          geo.starCenterY,
          STAR_FALL_BOW,
          STAR_FALL_TURNS,
          0,
          0,
          Math.min(1, cp + 0.008)
        );
        heading = (Math.atan2(gasOut.y - starNowY, gasOut.x - starNowX) * 180) / Math.PI;
      }

      /* The event box carries the travel, so the corona rides along with the
         body instead of being left parked behind it — it is a sibling of the
         body, not a child, so a transform on the body alone would have torn the
         two apart the moment the star started moving. */
      eventEl.style.transform = `translate(${(starNowX - geo.starCenterX).toFixed(1)}px, ${(starNowY - geo.starCenterY).toFixed(1)}px)`;

      /* The star itself. Distorts gently for twenty seconds, then comes apart:
         stretched along its own direction of travel, flattened across it, and
         faded out — no erosion clip of the kind Pluto's rock body gets, because
         a star coming apart is gas losing its boundary, not a solid breaking
         along an edge, and a ragged tear line would put exactly the wrong
         material read on it.

         The stretch is applied AFTER a rotate into `heading`, so the
         spaghettification lies along the spiral the star is following rather
         than staying stubbornly horizontal while the body curves away from it.
         During the stream `heading` is 0 and this is the plain rightward tidal
         bulge it always was. */
      const body = bodyRef.current;
      if (body) {
        const stretchX = 1 + sp * STAR_STREAM_STRETCH + cp * STAR_COLLAPSE_STRETCH;
        const squashY = 1 - sp * 0.05 - cp * 0.72;
        // Shrinks as it is consumed: by the time it reaches the horizon there
        // should be visibly less star than set out.
        const drain = 1 - cp * 0.45;
        body.style.transform = `rotate(${heading.toFixed(2)}deg) scaleX(${(stretchX * drain).toFixed(3)}) scaleY(${(squashY * drain).toFixed(3)})`;

        /* The star is eaten FROM ITS LEADING EDGE, not faded out as a whole.
           An explicit request: it should disappear from the right first and go
           on disappearing until the last of it is in, rather than the whole
           body dimming uniformly and vanishing at once — which is what a plain
           opacity ramp does, and it reads as the star turning invisible rather
           than as it being swallowed.

           A mask gradient, and it is applied in the element's own coordinates
           BEFORE the rotate above, so "to right" tracks the direction of travel
           for free: whichever way the spiral has turned the body, the edge being
           erased is the one going in first. `--eat-keep` is the only thing
           written per frame — the gradient itself is declared once in hub.css,
           so this is one custom-property update rather than a full mask-image
           string to re-parse. Opacity now barely moves, since the mask is doing
           the disappearing; it only dims enough to sit down into the glare. */
        /* Runs from 100% down past zero to -14%, not down to 0%. At 0% the
           gradient is still `#000 0, #000 0%, transparent 13%` — a feather's
           worth of the very left edge survives, and it was getting hard-cut the
           instant the flare took over. Overshooting by the feather width puts
           the transparent stop at -1%, i.e. the whole body, so the last of the
           star is genuinely gone at the moment it arrives. */
        const keep = (1 - Math.pow(cp, 1.15)) * 114 - 14;
        body.style.setProperty("--eat-keep", `${keep.toFixed(2)}%`);
        body.style.opacity = flaring ? "0" : (arrive * (1 - cp * 0.25)).toFixed(3);
      }
      // Only carried for the collapse — see .hb-bluestar-body.is-eaten in
      // hub.css for why the mask is not simply left on permanently.
      if (collapsing !== wasCollapsing) {
        bodyRef.current?.classList.toggle("is-eaten", collapsing);
        wasCollapsing = collapsing;
      }

      /* The hot crescent on the star's hole-facing limb — the actual "우측부분의
         푸른색 가스" the request names, and the visual cue that says which side
         is being stripped. Brightens across the stream, then goes with the
         body. */
      if (limbRef.current) {
        limbRef.current.style.opacity = flaring
          ? "0"
          : Math.max(0, arrive * (0.14 + sp * 0.86 - cp * 0.9)).toFixed(3);
      }

      /* Its corona. Faded out faster than the body is eaten (gone by cp~0.75
         rather than tracking it to 1), because the mask above only applies to
         the body — the corona is its sibling, not its child, and cannot share
         it: the mask has to sit in the body's own unrotated frame to track the
         direction of travel, which this element does not have. Left on longer it
         would have gone on drawing a full circle of glow out past the edge the
         star had already been eaten back from. */
      if (coronaRef.current) {
        coronaRef.current.style.opacity = flaring
          ? "0"
          : Math.max(0, arrive * (0.85 - cp * 1.15)).toFixed(3);
      }

      /* The tidal stream's underlay: one wide, soft ribbon from the star's
         limb to the hole, tapering brightest at the horizon end. The motes
         below supply the motion and the winding; this supplies the continuity
         between them, which 30 discrete points cannot on their own. Its
         geometry is entirely static (both ends are fixed elements), so it
         needs no per-frame position — only how bright and how thick it is,
         which is what the two writes here are. */
      if (streamRef.current) {
        const thickness = streaming
          ? 1 + 0.14 * Math.sin(t * 1.7)
          : collapsing
            ? 1 + cp * 1.5
            : 1;
        /* Fades out across the collapse rather than brightening through it.
           This ribbon's geometry is static — it spans the PARKED star position
           to the hole — so once the star pulls off that line and starts
           spiralling, it is no longer describing anything that exists, and
           leaving it lit drew a straight bar through the middle of a curve. */
        streamRef.current.style.opacity = flaring
          ? "0"
          : (arrive * (0.1 + sp * 0.5) * Math.max(0, 1 - cp * 1.6)).toFixed(3);
        // The translate has to be repeated, not just the scale — see
        // .hb-bluestar-stream in hub.css: `transform` is one property, so
        // writing a bare scaleY() here would drop the stylesheet's own
        // translateY(50%) and drop the ribbon off the hole's centre line.
        streamRef.current.style.transform = `translateY(50%) scaleY(${thickness.toFixed(3)})`;
      }

      /* The hole's own blue glow, brightening monotonically across the whole
         event — a faint cool halo while it is merely being fed, well up by the
         time the star is draining, and then the request's "푸른색으로 밝게 3초간
         점점 밝아지며" as the last of it goes in. Driven per-frame from this one
         clock rather than as a CSS transition, so the three-second ramp is
         literally the three seconds this loop is counting and not a duration
         written down a second time in the stylesheet. */
      if (haloRef.current) {
        const halo = flaring ? 0.64 + fp * 0.36 : streaming ? 0.34 * Math.min(1, t / 2) : 0.34 + cp * 0.3;
        haloRef.current.style.opacity = halo.toFixed(3);
        /* The disc's own recolour (.hb-bh-recolor) rides the identical ramp —
           the halo lights the space around the hole, this swings the disc and
           horizon themselves, and both should climb together. Used to be a
           `filter: hue-rotate()` on `.hb-blackhole` itself instead, toggled as
           a class with its own CSS transition; see the long note on
           .hb-bh-recolor in hub.css for why that filter — sitting on the
           button wrapping BlackHoleBody's ~90 lines of continuously
           repainting SVG — was the actual source of the screen-wide stutter
           reported during this exact moment, and why a per-frame opacity
           write on a plain blended element replaces it for free here rather
           than needing a second clock. */
        if (recolorRef.current) recolorRef.current.style.opacity = halo.toFixed(3);
      }

      if (flaring !== wasFlaring) {
        blackHoleRef.current?.classList.toggle("is-feeding-blue", flaring);
        wasFlaring = flaring;
      }

      /* The gas. Every particle recycles on its own loop for as long as its
         phase is feeding, so the stream is continuous rather than a single
         volley — `% 1` on a ratio that just keeps climbing is the whole
         mechanism, and it is what holds the twenty seconds the request asks
         for without a gap anywhere in them. */
      if (ctx && sprites.length > 0) {
        /* Fade the previous frame rather than clearing it. `destination-out`
           at a low alpha subtracts a fraction of what is already there, so
           each particle leaves a decaying streak behind it — see the note on
           the whole gas system above for why that matters so much here: it is
           what turns discrete points into continuous filaments, and it is
           worth several times the particle count in apparent density. The
           alpha sets how long the tails are; higher fades faster. */
        ctx.globalCompositeOperation = "destination-out";
        ctx.globalAlpha = 1;
        // Lowered from 0.26 to lengthen the tails. Two things follow, both
        // wanted: a longer tail overlaps its own past more, which smooths the
        // medium further, and more residue survives each frame, which lifts the
        // whole field's brightness. Free on both counts — the fill is one rect
        // either way.
        ctx.fillStyle = "rgba(0,0,0,0.2)";
        ctx.fillRect(0, 0, cssW, cssH);

        // Additive from here on — see the gas system's note on why the pile-up
        // where the stream is densest is the point rather than an artefact.
        ctx.globalCompositeOperation = "lighter";

        const streamEnd = counts.stream;
        const collapseEnd = counts.stream + counts.collapse;
        // Each pool's intensity envelope, hoisted out of the loop: they depend
        // only on the clock, not on the particle.
        const streamGain = Math.min(1, t / 1.4) * (0.72 + cp * 0.28) * Math.max(0, 1 - fp * 3);
        const collapseGain =
          Math.min(1, cp * 6) * Math.min(1, (1 - cp) * 5) * (0.6 + Math.sin(Math.PI * cp) * 0.4);
        // The ring fills in over four seconds rather than being there from the
        // first frame — it is material the stream has delivered, so it should
        // visibly accumulate. It then outlives the stream slightly: gas already
        // in orbit does not stop the instant the supply does.
        const ringGain = Math.min(1, t / 4) * 0.98 * Math.max(0, 1 - fp * 1.6);
        // The collapse's source disc shrinks as the star drains, so the gas
        // converges on a point rather than continuing to pour off a full-size
        // body that is no longer there.
        const collapseR = geo.starRadius * (1 - cp * 0.8);
        const streamFeeding = fp < 0.34;
        const ringFeeding = fp < 0.62;

        for (let i = 0; i < particles.length; i += P_STRIDE) {
          const p = i / P_STRIDE;
          const isStream = p < streamEnd;
          const isCollapse = !isStream && p < collapseEnd;
          // Stream particles keep going through the collapse (the stream does
          // not stop when the star dissolves — it is what the star is
          // dissolving INTO) and fade out over the flare's first third rather
          // than being cut mid-flight. Collapse particles exist only for the
          // collapse. Ring particles run the whole event.
          if (isStream ? !streamFeeding : isCollapse ? !collapsing : !ringFeeding) continue;

          const since = isCollapse ? t - STAR_COLLAPSE_START : t;
          const local = (since * particles[i + P_SPEED] + particles[i + P_PHASE]) % 1;

          /* Faded at both ends of its own trip: in as it separates, out as it
             falls in. The fade-out starts as early as 0.55 because `local` is
             progress along the PATH, not across the screen — the radius decays
             as a power (see gasPoint), so by 0.55 a particle is already well
             inside the accretion disc and by 0.78 nearly on the horizon.
             Fading later than this left bright gas sitting on top of the black
             centre of the hole, which reads as debris in front of it rather
             than material falling into it. */
          /* The ring's own particles are pulled out EARLIER than the star-fed
             ones. They start much closer in, so a given `local` puts them at a
             far smaller radius, and their blobs are now up to 65px across —
             left on the star-fed schedule they were still bright a few px from
             the centre, spreading haze across the event horizon, which has to
             read as black or the hole stops looking like a hole. */
          const fadeFrom = isStream || isCollapse ? 0.55 : 0.42;
          const fadeSpan = isStream || isCollapse ? 0.33 : 0.3;
          const edge =
            local < 0.08
              ? local / 0.08
              : local > fadeFrom
                ? Math.max(0, 1 - (local - fadeFrom) / fadeSpan)
                : 1;
          const alpha =
            edge * particles[i + P_BRIGHT] * (isStream ? streamGain : isCollapse ? collapseGain : ringGain);
          // Below this the blit is invisible but still costs a full sprite's
          // worth of fill. Most of the pool sits here at any given moment.
          if (alpha < 0.012) continue;

          const ang = particles[i + P_ANGLE];
          const rel = particles[i + P_RADIUS];
          /* Where this particle was released from. The two star-fed pools use
             the star's CURRENT centre, not its parked one, so once it starts
             spiralling in its gas follows it round instead of continuing to
             pour out of the empty space it left. The shift is smooth, so
             in-flight particles bend along with the star rather than jumping.
             Ring particles are measured from the hole itself — they are already
             in orbit and have nothing to do with where the star has got to. */
          let srcX: number;
          let srcY: number;
          if (isStream || isCollapse) {
            const srcR = isStream ? geo.starRadius * rel : rel * collapseR;
            srcX = starNowX + srcR * Math.cos(ang);
            srcY = starNowY + srcR * Math.sin(ang);
          } else {
            const srcR = rel * STAR_GAP;
            srcX = geo.bhCenterX + srcR * Math.cos(ang);
            srcY = geo.bhCenterY + srcR * Math.sin(ang);
          }
          gasPoint(
            geo,
            srcX,
            srcY,
            particles[i + P_BOW],
            particles[i + P_TURNS],
            particles[i + P_WOBA],
            particles[i + P_WOBF],
            local
          );

          // Compressed on the way in — tidally squeezed and closer to the
          // hole at once, so the ribbon narrows toward the horizon.
          const size = particles[i + P_SIZE] * (1 - 0.5 * local);
          ctx.globalAlpha = alpha > 1 ? 1 : alpha;
          ctx.drawImage(
            sprites[particles[i + P_SPRITE]],
            gasOut.x - originX - size / 2,
            gasOut.y - originY - size / 2,
            size,
            size
          );
        }
        ctx.globalAlpha = 1;
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      rest();
    };
  }, [eventRef, bodyRef, limbRef, coronaRef, streamRef, haloRef, recolorRef, canvasRef, particles, counts, blackHoleRef]);
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
                         bluestar the blue star the hole eats after Pluto
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

  /* The blue star the hole eats immediately after Pluto — see
     useBlueStarEvent above. Shares blackHoleRef with the Pluto event (both
     drive the same hole's glow) and HB_FEED_CYCLE with its loop, so the two
     hand off to each other rather than overlapping. */
  const starEventRef = useRef<HTMLDivElement>(null);
  const starBodyRef = useRef<HTMLDivElement>(null);
  const starLimbRef = useRef<HTMLSpanElement>(null);
  const starCoronaRef = useRef<HTMLSpanElement>(null);
  const starStreamRef = useRef<HTMLSpanElement>(null);
  const starHaloRef = useRef<HTMLSpanElement>(null);
  const starRecolorRef = useRef<HTMLSpanElement>(null);
  const starCanvasRef = useRef<HTMLCanvasElement>(null);
  // Built once per tier and never rebuilt — the buffer is ~150KB at the full
  // tier and its contents are pure startup randomness, so re-deriving it on a
  // re-render would be both wasteful and visibly wrong (every particle would
  // jump to a new path mid-flight).
  const starGas = useMemo(() => {
    const counts = GAS_COUNTS[tier];
    return { buf: buildGasParticles(counts), counts };
  }, [tier]);
  useBlueStarEvent(
    starEventRef,
    starBodyRef,
    starLimbRef,
    starCoronaRef,
    starStreamRef,
    starHaloRef,
    starRecolorRef,
    starCanvasRef,
    starGas.buf,
    starGas.counts,
    blackHoleRef
  );

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
      {/* The blue glow of a hole that has just swallowed a blue star. Its own
          layer rather than a restyling of the amber corona or the red feeding
          halo, for the same reason those two are separate from each other:
          `background` does not interpolate between gradients, so sharing one
          element would snap to the other colour instead of cross-fading.

          OUTSIDE the button rather than inside it like `.hb-bh-bloom`, since
          this halo needs to spill past the button's own circular clip; the
          disc's OWN recolour is `.hb-bh-recolor` instead, a separate element
          nested inside the button (see where that one is rendered, and its
          long note in hub.css for why a `hue-rotate` filter used to live on
          the button itself and no longer does). Anchored to the hole's corner
          independently here (see hub.css). Its opacity is written per frame
          by useBlueStarEvent off the same ramp `.hb-bh-recolor`'s is, which is
          what makes the request's three-second brightening an actual ramp on
          both at once. */}
      <span className="hb-bh-blueflare" ref={starHaloRef} aria-hidden="true" />

      <button
        type="button"
        ref={blackHoleRef}
        className="hb-blackhole"
        onClick={() => open("/etf")}
        aria-label={en ? "Black hole: ETF MARKET" : "블랙홀: ETF 마켓"}
        title={en ? "Gargantua — ETF MARKET" : "가르강튀아 — ETF 마켓"}
      >
        {/* The hole's breathing bloom, deliberately a sibling of the art
            rather than part of it — see .hb-bh-bloom in hub.css for why an
            animation living inside that SVG was re-inking the entire
            accretion disc on every frame. */}
        <span className="hb-bh-bloom" aria-hidden="true" />
        <BlackHoleBody id="hub" lite={lite} minimal={minimal} />
        {/* The blue flare's own recolour of the disc — see the long note on
            .hb-bh-recolor in hub.css for why this replaced a `hue-rotate`
            filter that used to sit on the button itself: that filter forced a
            full re-rasterise of this SVG on every frame it was still
            transitioning, which is what was actually behind the screen-wide
            stutter reported during the hole's final swallow. A blend against
            the art immediately behind it costs a fraction of that, and can
            safely live INSIDE the button now that there is no parent filter
            left to double-apply to it. */}
        <span className="hb-bh-recolor" ref={starRecolorRef} aria-hidden="true" />
        {/* Named on hover the way Voyager is. The bodies on the orbital plane
            get their destination from the planet you already recognise; the
            hole doesn't, and it is now the only route to the TOP 100 boards,
            so it says so. Sits above the art rather than below it — this
            button is anchored to the bottom-right corner, where a tip hung
            underneath would fall off the viewport. */}
        {/* Names the market, not just "TOP 100" — the neutron binary opens the
            KOSDAQ board, so a generic label on either one would leave the pair
            looking like two routes to the same place. */}
        <span className="hb-blackhole-tip">{en ? "ETF MARKET" : "ETF 마켓"}</span>
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

      {/* The blue star the hole turns on the moment Pluto is gone: parked 400px
          to its left at 60% of the sun's size, stripped down its right limb for
          twenty seconds, then pulled apart entirely — see useBlueStarEvent
          above for the whole timeline and hub.css for the geometry. Built out
          of layered CSS gradients rather than the StarBody SVG the sun uses:
          that SVG's photosphere is an feTurbulence/feDiffuseLighting stack and
          is the single most expensive thing on this page (there is a ?hboff
          switch just for it), and a second copy of it running through a
          twenty-second event is not something this page has the headroom for.
          Gradients composite instead of repainting, which is the same trade the
          black hole's own corona already makes. */}
      <div
        className="hb-bluestar-event"
        ref={starEventRef}
        aria-hidden="true"
        style={{ "--bluestar-gap": `${STAR_GAP}px` } as React.CSSProperties}
      >
        <span className="hb-bluestar-corona" ref={starCoronaRef} />
        {/* The limb crescent lives INSIDE the body, not beside it, so the
            tidal stretch written onto the body carries it along — a sibling
            would stay a neat circle while the star it belongs to elongated. */}
        <div className="hb-bluestar-body" ref={starBodyRef}>
          {/* The blazing rim: one soft ambient halo plus BLUESTAR_FLAME's
              twenty-six individually-timed heat-haze wisps (see hub.css and
              buildBlueStarHaze above) — pure CSS, no refs of their own.
              All of it rides the body's own per-frame opacity/transform for
              free just by being its children, so the shimmer arrives,
              stretches and gets eaten along with the star rather than
              needing a second animation loop to keep in sync. */}
          <span className="hb-bluestar-halo" />
          {BLUESTAR_FLAME.map((wisp, i) => (
            <span
              key={i}
              className={`hb-bluestar-wisp${wisp.pull ? " hb-bluestar-wisp--pull" : ""}`}
              style={
                {
                  "--wisp-left": `${wisp.left.toFixed(2)}%`,
                  "--wisp-top": `${wisp.top.toFixed(2)}%`,
                  "--wisp-size": `${wisp.size.toFixed(2)}%`,
                  "--wisp-rot": `${wisp.rot.toFixed(1)}deg`,
                  "--wisp-pull": `${wisp.pullDist.toFixed(0)}%`,
                  animationDuration: `${wisp.duration.toFixed(2)}s`,
                  animationDelay: `${wisp.delay.toFixed(2)}s`,
                } as React.CSSProperties
              }
            />
          ))}
          <span className="hb-bluestar-limb" ref={starLimbRef} />
        </div>
      </div>

      {/* The stream and the gas that rides it, in their own full-viewport
          layer — same reason .hb-pluto-fx is separate from .hb-pluto-event:
          every mote's flight is computed in real screen coordinates from the
          hole's and the star's own getBoundingClientRect(), which needs a
          plain fixed (0, 0) origin to sit against. */}
      <div
        className="hb-bluestar-fx"
        aria-hidden="true"
        style={
          {
            "--bluestar-gap": `${STAR_GAP}px`,
            "--gas-reach": `${GAS_REACH}px`,
          } as React.CSSProperties
        }
      >
        <span className="hb-bluestar-stream" ref={starStreamRef} />
        {/* Every gas particle, on one canvas. This replaced ~50 individually
            positioned <span>s: at that count the stream read as a countable
            spray of dots rather than as gas, and the count could not simply be
            raised, because each span is another composited layer taking two
            style writes a frame (the Pluto event above documents where that
            ceiling sits). On a canvas the cost is per-pixel instead of
            per-element, which buys ~1,800 particles AND costs less than the 50
            spans did — see the long note on the gas system in Hub.tsx for the
            three things that make that true. */}
        <canvas className="hb-bluestar-canvas" ref={starCanvasRef} />
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
        onClick={() => open("/kospi-100")}
        aria-label={en ? "Neutron binary: KOSPI TOP 100" : "중성자 쌍성: 코스피 TOP 100"}
        title={en ? "Neutron star merger — KOSPI TOP 100" : "중성자별 병합 — 코스피 TOP 100"}
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
        <span className="hb-neutron-tip">{en ? "KOSPI TOP 100" : "코스피 TOP 100"}</span>
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
              <Link to="/dashboard" className="hb-wordmark-link">
                <span className="hb-wordmark-main">K-STOCK</span>
                <span className="hb-wordmark-sub">HUB</span>
              </Link>
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
                <span className="hb-tag hb-star-tag">
                  <span className="hb-tag-name">HUB</span>
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
