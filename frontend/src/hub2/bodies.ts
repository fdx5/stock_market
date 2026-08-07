/* ============================================================================
   ORBIT II — the world's contents.
   ----------------------------------------------------------------------------
   Type 2 of the entrance. The original (/) draws the same solar system out of
   CSS 3D transforms; this one hands it to WebGL, so everything here is in
   *scene units* rather than design pixels and the numbers do not carry over.

   One unit ≈ one sun radius / 8. The layout is not to scale (nothing legible
   ever is — Neptune is 30 AU out and Jupiter is 11 Earths wide), but every
   relative ordering the real system has is kept: radii strictly increase
   outward, Jupiter is the largest planet, Saturn's rings are the widest
   feature, Venus and Uranus spin backwards, and each moon set sits in its
   host's equatorial plane in real closest-to-farthest order.

   Destinations are deliberately identical to the type-1 hub's, body for body,
   so the two entrances are two *renderings* of one site map rather than two
   different site maps. See Hub.tsx's PLANETS/MOONS for the original.
   ========================================================================= */

/** Which live index prints on a body, if any. */
export type FeedKey = "KOSPI" | "KOSDAQ" | "SPX" | "NDX";

export interface RingSpec {
  /** Inner/outer radius as a multiple of the host's own radius. */
  inner: number;
  outer: number;
  /** Radians the ring plane is tipped off the host's equator. */
  tilt: number;
  color: [number, number, number];
  /** Saturn's rings are a broad banded sheet; Uranus's are a set of thin,
   * dark, widely separated hoops. One shader, two very different looks. */
  style: "saturn" | "uranus";
  opacity: number;
}

export interface MoonSpec {
  key: string;
  ko: string;
  en: string;
  /** Where clicking it goes. Moons mostly echo their host, except Earth's two
   * corporate satellites, which open their own stock pages. */
  to: string;
  texture: string;
  /** Orbit radius in scene units, measured from the host's centre. */
  radius: number;
  /** Body radius in scene units. */
  size: number;
  /** Seconds for one revolution. */
  period: number;
  /** Where on the ring it starts, 0..1. */
  phase: number;
  /** Seconds for one rotation about its own axis. */
  spin: number;
  /** Rim/atmosphere tint, also the colour its HUD label glows. */
  glow: string;
  /** Earth's Samsung/SK hynix satellites are logo billboards, not textured
   * spheres — there is no photograph of a company. */
  logo?: string;
  /** Mars's Starship: a sprite that climbs and lands rather than an orbiter. */
  craft?: "starship";
  /** Io's plumes and Enceladus's geysers — real features of exactly these two
   * bodies, and the only two moons that get their own particle emitter. */
  vent?: "io" | "enceladus";
}

export interface PlanetSpec {
  key: string;
  /** The destination this body opens — what the HUD labels it. */
  ko: string;
  en: string;
  /** What the body actually *is*. Shown on hover, because "코스피" tells you
   * where the click goes and "지구" tells you what you are pointing at, and a
   * page built on "click the planet you recognise" owes the visitor both. */
  bodyKo: string;
  bodyEn: string;
  to: string;
  texture: string;
  /** Orbit radius in scene units. */
  radius: number;
  /** Body radius in scene units. */
  size: number;
  /** Seconds for one revolution around the star. */
  period: number;
  phase: number;
  /** Seconds for one rotation. Negative = retrograde (Venus, Uranus). */
  spin: number;
  /** Rim colour — the atmospheric scattering halo on the lit limb, and the
   * body's HUD accent. */
  glow: string;
  /** How much atmosphere the rim shader gives it. Airless rocks (Mercury)
   * get almost none; the ice giants get a lot. */
  atmosphere: number;
  /** Radians the orbit is tipped off the ecliptic, so the rings don't all
   * collapse into one line when the camera drops near the plane. */
  inclination: number;
  /** Per-body exposure trim, 1 = untouched. The textures are real albedo maps
   * and their mean brightness varies by more than a factor of two, so a single
   * global gain cannot light them all: at a level that reads well for Saturn's
   * pale, near-flat gas, Mercury's rock and Neptune's deep blue render as
   * near-black dots — accurate, and useless on a page where "click the planet
   * you recognise" IS the navigation. Saturn and Uranus are pulled slightly
   * *down* so that the shared gain, raised for the other six, leaves the two
   * ringed bodies looking exactly as they did. */
  brightness: number;
  feed?: FeedKey;
  ring?: RingSpec;
  moons?: MoonSpec[];
}

const TEX = "/img/planets";

/* ─────────────────────────── moons ─────────────────────────── */

const EARTH_MOONS: MoonSpec[] = [
  {
    key: "moon",
    ko: "달",
    en: "Moon",
    to: "/map",
    texture: `${TEX}/moon.webp`,
    radius: 3.6,
    size: 0.55,
    period: 24,
    phase: 0,
    spin: 24, // tidally locked, like the real one
    glow: "#cfc9be",
  },
  {
    key: "samsung",
    ko: "삼성전자",
    en: "Samsung",
    to: "/dashboard?code=005930",
    texture: "",
    radius: 5.2,
    size: 0.42,
    period: 9,
    phase: 0.15,
    spin: 9,
    glow: "#5fa8ff",
    logo: "005930",
  },
  {
    key: "skhynix",
    ko: "SK하이닉스",
    en: "SK hynix",
    to: "/dashboard?code=000660",
    texture: "",
    radius: 6.6,
    size: 0.42,
    period: 13,
    phase: 0.62,
    spin: 13,
    glow: "#ffb45c",
    logo: "000660",
  },
];

const MARS_MOONS: MoonSpec[] = [
  {
    key: "starship",
    ko: "SpaceX",
    en: "SpaceX",
    // SpaceX is on no exchange this app tracks; GlobalStockPage reads ?code=
    // itself, and a relative path keeps local dev pointed at local dev.
    to: "/global?code=SPCX",
    texture: "",
    radius: 3.1,
    size: 0.5,
    period: 11,
    phase: 0.3,
    spin: 11,
    glow: "#ffd9a8",
    craft: "starship",
  },
];

/* Real closest-to-farthest order. Sizes hold the real ratios to each other
   (Ganymede largest, Europa smallest of the four) rather than to Jupiter,
   which at true scale would make all four invisible. */
/* Orbit radii carry the same factor their host's `size` does — Jupiter's ×2,
   Saturn's ×1.5. Scaling both together is the whole point: every relationship
   that was tuned here survives it. Io still clears the cloud tops by the same
   proportion, Mimas still sits at the same place in the rings (whose inner and
   outer edges are multiples of `size`, so they scale for free), and the four
   Galileans keep their spacing. Scaling the planet alone would have put its
   inner moons inside it. */
const JUPITER_MOONS: MoonSpec[] = [
  { key: "io", ko: "이오", en: "Io", to: "/sp500-map", texture: `${TEX}/io.webp`, radius: 14.4, size: 0.62, period: 16, phase: 0, spin: 16, glow: "#d9a85f", vent: "io" },
  { key: "europa", ko: "유로파", en: "Europa", to: "/sp500-map", texture: `${TEX}/europa.webp`, radius: 18.0, size: 0.54, period: 26, phase: 0.35, spin: 26, glow: "#d8cfba" },
  { key: "ganymede", ko: "가니메데", en: "Ganymede", to: "/sp500-map", texture: `${TEX}/ganymede.webp`, radius: 22.8, size: 0.92, period: 42, phase: 0.6, spin: 42, glow: "#9c9483" },
  { key: "callisto", ko: "칼리스토", en: "Callisto", to: "/sp500-map", texture: `${TEX}/callisto.webp`, radius: 28.4, size: 0.85, period: 62, phase: 0.85, spin: 62, glow: "#5f5c56" },
];

const SATURN_MOONS: MoonSpec[] = [
  { key: "mimas", ko: "미마스", en: "Mimas", to: "/ai-prediction", texture: `${TEX}/mimas.webp`, radius: 12.9, size: 0.34, period: 18, phase: 0.1, spin: 18, glow: "#d8d2c4" },
  { key: "enceladus", ko: "엔셀라두스", en: "Enceladus", to: "/ai-prediction", texture: `${TEX}/enceladus.webp`, radius: 15.6, size: 0.4, period: 26, phase: 0.5, spin: 26, glow: "#eaf4ff", vent: "enceladus" },
  { key: "titan", ko: "타이탄", en: "Titan", to: "/ai-prediction", texture: `${TEX}/titan.webp`, radius: 20.7, size: 0.96, period: 52, phase: 0.8, spin: 52, glow: "#e8a35c" },
];

/* ─────────────────────────── planets ─────────────────────────── */

export const PLANETS: PlanetSpec[] = [
  {
    key: "mercury",
    ko: "글로벌 뉴스",
    en: "GLOBAL NEWS",
    bodyKo: "수성",
    bodyEn: "Mercury",
    to: "/news",
    texture: `${TEX}/mercury.webp`,
    radius: 26,
    size: 1.05,
    period: 34,
    phase: 0.06,
    spin: 9,
    glow: "#c9beae",
    atmosphere: 0.12, // effectively none — Mercury has no air to scatter
    inclination: 0.06,
    // Dark, airless rock — the darkest surface of the eight.
    brightness: 1.5,
  },
  {
    key: "venus",
    ko: "코스닥",
    en: "KOSDAQ",
    bodyKo: "금성",
    bodyEn: "Venus",
    to: "/kosdaq-map",
    texture: `${TEX}/venus.webp`,
    radius: 37,
    size: 1.85,
    period: 40,
    phase: 0.56,
    spin: -13, // retrograde, as the real Venus is
    glow: "#f5e2ab",
    atmosphere: 1.0, // the thickest atmosphere of any rocky planet
    inclination: -0.04,
    // Bright cloud deck already; needs the least help.
    brightness: 1.25,
    feed: "KOSDAQ",
  },
  {
    key: "earth",
    ko: "코스피",
    en: "KOSPI",
    bodyKo: "지구",
    bodyEn: "Earth",
    to: "/map",
    texture: `${TEX}/earth.webp`,
    radius: 50,
    size: 1.95,
    period: 50,
    phase: 0.2,
    spin: 11,
    glow: "#5fa8ff",
    atmosphere: 0.85,
    inclination: 0,
    // Oceans cover most of the disc and drink the light.
    brightness: 1.45,
    feed: "KOSPI",
    moons: EARTH_MOONS,
  },
  {
    key: "mars",
    ko: "나스닥 100",
    en: "NASDAQ 100",
    bodyKo: "화성",
    bodyEn: "Mars",
    to: "/nasdaq100-map",
    texture: `${TEX}/mars.webp`,
    radius: 65,
    size: 1.4,
    period: 58,
    phase: 0.68,
    spin: 10,
    glow: "#ff8f5c",
    atmosphere: 0.3,
    inclination: 0.05,
    // Dust is redder and darker than it photographs.
    brightness: 1.4,
    feed: "NDX",
    moons: MARS_MOONS,
  },
  {
    key: "jupiter",
    ko: "S&P 500",
    en: "S&P 500",
    bodyKo: "목성",
    bodyEn: "Jupiter",
    to: "/sp500-map",
    texture: `${TEX}/jupiter.webp`,
    /* Moved out from 96 to clear the asteroid belt, which runs 72–88.
       At the doubled size below the disc alone reached in to 86.8 and grazed
       the band; at 118 it reaches in to 108.8, and Callisto — the outermost
       moon, orbiting at 28.4 — comes no closer than 89.6. So the whole Jovian
       system now sits outside the belt, not just the planet. */
    radius: 118,
    // Twice what it was.
    size: 9.2,
    period: 74,
    phase: 0.78,
    spin: 16,
    glow: "#e0b177",
    atmosphere: 0.55,
    inclination: -0.03,
    // Banded but reasonably bright to begin with.
    brightness: 1.25,
    feed: "SPX",
    moons: JUPITER_MOONS,
  },
  {
    key: "saturn",
    ko: "AI 예측",
    en: "AI FORECAST",
    bodyKo: "토성",
    bodyEn: "Saturn",
    to: "/ai-prediction",
    texture: `${TEX}/saturn.webp`,
    /* Out from 132 to keep its distance from Jupiter's new orbit. The ring
       sheet reaches 2.35 × size, so the disc here ends at 157.75 and Titan
       swings out to 164.7 — which is why Uranus had to move too rather than
       this one being squeezed back in: at its old 164 its own rings started at
       159, barely a unit outside Saturn's, and Titan crossed its track
       outright. Pulling Saturn inward instead would only have pushed the same
       collision onto Jupiter. */
    radius: 144,
    // Half again what it was. The ring's inner and outer are multiples of this,
    // so the sheet grows with the planet and keeps its proportions.
    size: 5.85,
    period: 66,
    phase: 0.42,
    spin: 18,
    glow: "#e8cf9a",
    atmosphere: 0.5,
    inclination: 0.09,
    // Pale gas plus the brightest rings on the page. Held where it was.
    brightness: 0.8,
    ring: { inner: 1.28, outer: 2.35, tilt: 0.47, color: [0.93, 0.85, 0.7], style: "saturn", opacity: 1 },
    moons: SATURN_MOONS,
  },
  {
    key: "uranus",
    ko: "시총 대결",
    en: "CAP BATTLE",
    bodyKo: "천왕성",
    bodyEn: "Uranus",
    to: "/fight",
    texture: `${TEX}/uranus.webp`,
    /* Out from 164 to clear Saturn. Its own rings reach in to 173 from here,
       which is 15 units clear of Saturn's ringed disc and 8 clear of Titan at
       the top of its swing — a gap the eye can actually read as a gap. */
    radius: 178,
    size: 2.5,
    period: 84,
    phase: 0.14,
    spin: -14, // retrograde: its axis is tipped ~98°
    glow: "#8fe9e0",
    atmosphere: 0.95,
    inclination: -0.07,
    // Flat pale cyan, and ringed. Held where it was.
    brightness: 0.8,
    // Which is also why its rings stand almost vertical against Saturn's.
    ring: { inner: 1.5, outer: 2.0, tilt: 1.5, color: [0.55, 0.72, 0.78], style: "uranus", opacity: 0.75 },
  },
  {
    key: "neptune",
    ko: "글로벌 시총",
    en: "GLOBAL TOP 100",
    bodyKo: "해왕성",
    bodyEn: "Neptune",
    to: "/global-top100",
    texture: `${TEX}/neptune.webp`,
    /* Follows Uranus out, from 194, so the outermost pair keep their spacing
       rather than Neptune being left sitting on Uranus's rings. This is the
       edge of the system, and the resting camera sits ~283 units out with room
       to spare — the outermost track still frames comfortably. */
    radius: 206,
    size: 2.4,
    period: 104,
    phase: 0.32,
    spin: 15,
    glow: "#4d6dff",
    atmosphere: 1.0,
    inclination: 0.04,
    // Deep blue, and the darkest body here after Mercury.
    brightness: 1.7,
  },
];

/* ─────────────────────── the things off the plane ───────────────────────
   Three bodies that are not part of the orbital system and are positioned in
   the sky instead: the two TOP 100 boards and the probe. They keep the type-1
   hub's own pairing — the hole opens KOSPI's board, the neutron binary opens
   KOSDAQ's — so that neither market's board is reachable only through the
   other's. */

export interface LandmarkSpec {
  key: string;
  ko: string;
  en: string;
  /** What it is, as opposed to where it goes — see PlanetSpec.bodyKo. */
  bodyKo: string;
  bodyEn: string;
  to: string;
  /** Fixed world position. Well outside Neptune's orbit, and off the ecliptic
   * so a camera sitting in the plane still sees them clear of the rings. */
  position: [number, number, number];
}

export const BLACK_HOLE: LandmarkSpec = {
  key: "blackhole",
  ko: "코스피 TOP 100",
  en: "KOSPI TOP 100",
  bodyKo: "블랙홀",
  bodyEn: "Black hole",
  to: "/kospi-100",
  position: [-215, 46, -150],
};

export const NEUTRON_BINARY: LandmarkSpec = {
  key: "neutron",
  ko: "코스닥 TOP 100",
  en: "KOSDAQ TOP 100",
  bodyKo: "중성자별",
  bodyEn: "Neutron star",
  to: "/kosdaq-100",
  /* Pushed further back and inboard from an earlier (235, 62, -120). This is
     the one landmark that periodically grows: the merger throws a remnant a
     hundred units across, and from the resting camera the old position put its
     centre so near the right edge that half the explosion happened off-screen.
     Still well outside Neptune's 194 — it has to read as deep sky, not as part
     of the system. */
  position: [170, 35, -230],
};

export const VOYAGER: LandmarkSpec = {
  key: "voyager",
  ko: "글로벌 뉴스",
  en: "GLOBAL NEWS",
  bodyKo: "보이저 1호",
  bodyEn: "Voyager 1",
  to: "/news",
  // Not actually fixed — the probe coasts outward on its own track and this is
  // only where it starts. See the scene's voyager rig.
  position: [0, 18, 0],
};

export const STAR: LandmarkSpec = {
  key: "sun",
  ko: "대시보드",
  en: "DASHBOARD",
  bodyKo: "태양",
  bodyEn: "Sun",
  to: "/dashboard",
  position: [0, 0, 0],
};

/** Every clickable destination, in the order the HUD dock lists them. Built
 * from the same specs the 3D scene reads, so the dock can never drift out of
 * sync with what is actually in the sky. */
export interface Destination {
  key: string;
  ko: string;
  en: string;
  to: string;
  feed?: FeedKey;
  accent: string;
}

export const DESTINATIONS: Destination[] = [
  { key: "sun", ko: "대시보드", en: "DASHBOARD", to: "/dashboard", accent: "#ffce6a" },
  ...PLANETS.map((p) => ({ key: p.key, ko: p.ko, en: p.en, to: p.to, feed: p.feed, accent: p.glow })),
  { key: "blackhole", ko: BLACK_HOLE.ko, en: BLACK_HOLE.en, to: BLACK_HOLE.to, accent: "#ff9a4d" },
  { key: "neutron", ko: NEUTRON_BINARY.ko, en: NEUTRON_BINARY.en, to: NEUTRON_BINARY.to, accent: "#9fd0ff" },
];

/** What the auto tour visits, in order: the eight planets from the inside out,
 * then the two landmarks out in deep sky.
 *
 * Not the star. The tour exists to show you the bodies you would otherwise
 * have to go looking for — the sun is already at the centre of the resting
 * view, dead ahead, and flying to it means flying to where the camera was
 * pointing all along. Everything here is somewhere you cannot see properly
 * from the front door. */
export const TOUR_ORDER: string[] = [
  ...PLANETS.map((p) => p.key),
  BLACK_HOLE.key,
  NEUTRON_BINARY.key,
];

/** Pluto: not a destination. It drifts in from the black hole's left, is torn
 * apart by it, and the cycle repeats — the type-1 hub's signature event, kept.
 * (It is also, by the IAU's 2006 reckoning, no longer a planet, which is the
 * joke.) */
export const PLUTO_TEXTURE = `${TEX}/pluto.webp`;
export const SUN_TEXTURE = `${TEX}/sun.webp`;
