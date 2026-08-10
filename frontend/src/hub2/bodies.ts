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
  /** Seconds for one revolution. Negative = retrograde, i.e. against the way
   * its host spins — which among these is Triton alone, as in life. */
  period: number;
  /** Where on the ring it starts, 0..1. */
  phase: number;
  /** Seconds for one rotation about its own axis. */
  spin: number;
  /** Rim/atmosphere tint, also the colour its HUD label glows. */
  glow: string;
  /** Relative radii on the three axes, for a body that is not round.
   *
   * Most moons are: they are heavy enough that their own gravity pulls them
   * into a sphere. The small ones are not — below a certain mass a body keeps
   * whatever shape it was left in, and drawing one as a ball says something
   * about it that is not true. Omitted means round. */
  shape?: [number, number, number];
  /** How far from smooth. A body too small to be round is not merely a
   * squashed ball — it is lumpy, and the large craters bite into its outline.
   * This is the depth of that displacement as a fraction of the radius; see
   * irregularGeometry in scene.ts for what it does with it. */
  irregular?: number;
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
    key: "phobos",
    ko: "포보스",
    en: "Phobos",
    // No page of its own; it echoes its host, like the outer moons do.
    to: "/map",
    texture: `${TEX}/phobos.webp`,
    /* Close in, because the real one is: Phobos orbits nearer its planet than
       any other moon in the solar system, low enough that it crosses the
       Martian sky twice a day and rises in the west. */
    radius: 2.4,
    /* A third of the Moon's, per an explicit request, and nothing like the
       truth — the real Phobos is about 11 km across against the Moon's 1,737,
       so a hundred and fifty times smaller. At that ratio it would be a body
       you could not see, let alone point a telescope at. The real figures are
       in the observation panel, which is the place for them. */
    size: 0.18,
    // Faster than Mars turns, as the real one is: it laps its own planet.
    period: 6,
    phase: 0.62,
    spin: 6, // tidally locked
    glow: "#9a8d80",
    /* 27 × 22 × 18 km, normalised to the long axis — the real proportions of
       the real body. Phobos is far too small for its own gravity to have
       rounded it, and the observation panel says so; drawing it as a ball made
       the picture contradict the caption beside it. */
    shape: [1, 0.67, 0.81],
    /* And not a smooth one. The ellipsoid was closer than a ball and still
       wrong: Phobos is lumpy, and Stickney — nine kilometres across a body
       twenty-seven long — takes a visible bite out of its outline. */
    irregular: 0.34,
  },
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
   proportion, the ring sheets keep their proportions for free (their inner and
   outer edges are multiples of `size`), and the four Galileans keep their
   spacing. Scaling the planet alone would have put its inner moons inside it.
   The one relationship the scaling did *not* fix is Saturn's innermost moon,
   which was inside the ring sheet before and stayed there after — see
   SATURN_MOONS. */
const JUPITER_MOONS: MoonSpec[] = [
  { key: "io", ko: "이오", en: "Io", to: "/sp500-map", texture: `${TEX}/io.webp`, radius: 14.4, size: 0.62, period: 16, phase: 0, spin: 16, glow: "#d9a85f", vent: "io" },
  { key: "europa", ko: "유로파", en: "Europa", to: "/sp500-map", texture: `${TEX}/europa.webp`, radius: 18.0, size: 0.54, period: 26, phase: 0.35, spin: 26, glow: "#d8cfba" },
  { key: "ganymede", ko: "가니메데", en: "Ganymede", to: "/sp500-map", texture: `${TEX}/ganymede.webp`, radius: 22.8, size: 0.92, period: 42, phase: 0.6, spin: 42, glow: "#9c9483" },
  { key: "callisto", ko: "칼리스토", en: "Callisto", to: "/sp500-map", texture: `${TEX}/callisto.webp`, radius: 28.4, size: 0.85, period: 62, phase: 0.85, spin: 62, glow: "#5f5c56" },
];

/* The ring sheet ends at 2.35 × 5.85 = 13.75, and the moons orbit in the same
   plane the sheet lies in, so anything closer than that rides through the
   rings rather than around them. Mimas at 12.9 and Enceladus at 15.6 put the
   inner one squarely inside the disc; both are moved out to clear it, which is
   also where the real ones are — Mimas orbits at ~3.1 Saturn radii and the A
   ring's outer edge is at ~2.3, so it is outside the main rings by a margin
   the eye can see, not grazing them. Titan is left at 20.7: it is the outer
   constraint on the whole Saturnian system (any further and it reaches into
   Uranus's rings), so the two inner moons close the gap to it instead. That
   leaves 1.46 units between Mimas and Enceladus and 2.14 between Enceladus and
   Titan, once each pair's own radii are taken out. */
const SATURN_MOONS: MoonSpec[] = [
  { key: "mimas", ko: "미마스", en: "Mimas", to: "/ai-prediction", texture: `${TEX}/mimas.webp`, radius: 15, size: 0.34, period: 18, phase: 0.1, spin: 18, glow: "#d8d2c4" },
  { key: "enceladus", ko: "엔셀라두스", en: "Enceladus", to: "/ai-prediction", texture: `${TEX}/enceladus.webp`, radius: 17.2, size: 0.4, period: 26, phase: 0.5, spin: 26, glow: "#eaf4ff", vent: "enceladus" },
  { key: "titan", ko: "타이탄", en: "Titan", to: "/ai-prediction", texture: `${TEX}/titan.webp`, radius: 20.7, size: 0.96, period: 52, phase: 0.8, spin: 52, glow: "#e8a35c" },
];

/* The two outer moons, one each, both at half the Moon's size — an explicit
   request, so they do not follow the "hold the real ratios within the set"
   rule the Jovian and Saturnian sets do. Each is the largest moon of its host,
   and each orbit radius is set the way the others are: outside anything its
   host carries, and short enough that the moon never reaches the neighbouring
   planet's track. Titania at 10 clears Uranus's rings (which end at 2 × 3.75 =
   7.5) and still stops 3.3 units short of Titan at the top of its own swing;
   Triton at 9.5 leaves 8.5 units between Neptune's system and Titania's. */
const URANUS_MOONS: MoonSpec[] = [
  // Uranus's equatorial plane is tipped ~98°, so this orbit stands almost
  // vertical — scene.ts hangs the moons off the same axis as the rings, which
  // is exactly where the real Titania goes.
  { key: "titania", ko: "티타니아", en: "Titania", to: "/fight", texture: `${TEX}/titania.webp`, radius: 10, size: 0.275, period: 30, phase: 0.2, spin: 30, glow: "#c9c2b8" },
];

const NEPTUNE_MOONS: MoonSpec[] = [
  // Negative period *and* negative spin: Triton is the one large moon in the
  // solar system that orbits backwards, and it is tidally locked, so its day
  // runs backwards with its year. It is almost certainly a captured Kuiper
  // belt object, which is why it is the odd one out here.
  { key: "triton", ko: "트리톤", en: "Triton", to: "/global-top100", texture: `${TEX}/triton.webp`, radius: 9.5, size: 0.275, period: -26, phase: 0.55, spin: -26, glow: "#d8d2b8" },
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
    /* Out from 164 to clear Saturn. Its own rings reach in to 170.5 from here,
       which is 12.75 units clear of Saturn's ringed disc and 5.8 clear of
       Titan at the top of its swing — a gap the eye can actually read as a
       gap, even after the size below grew the ring sheet inward with it. */
    radius: 178,
    // Half again what it was. The ring's inner and outer are multiples of this,
    // so the hoops grow with the planet and keep their proportions.
    size: 3.75,
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
    moons: URANUS_MOONS,
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
    // Half again what it was, matching Uranus's own step so the outermost pair
    // keep the size ordering they had. Ringless, so nothing else moves with it.
    size: 3.6,
    period: 104,
    phase: 0.32,
    spin: 15,
    glow: "#4d6dff",
    atmosphere: 1.0,
    inclination: 0.04,
    // Deep blue, and the darkest body here after Mercury.
    brightness: 1.7,
    moons: NEPTUNE_MOONS,
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

/** The wormhole, hanging just off the outer edge of Saturn's rings — where
 * Interstellar's is, and for the reason that film puts it there: far enough
 * out to be a journey, near enough to a body everybody can name that its
 * distance means something.
 *
 * Not a destination. It is the one thing in this sky that is not a place on
 * this site, and the point of it is that it goes somewhere the site does not.
 *
 * `position` is NOT a world position, unlike every other landmark here. It is
 * an offset in Saturn's own equatorial frame — the frame the ring sheet lies
 * in — because the wormhole travels with Saturn. It has to: Saturn goes round
 * the sun in sixty-six seconds, so a fixed point "near the rings" is near them
 * for about four of those and on the far side of the system for the rest.
 *
 * 27 out and 17 up — twice the stand-off it was first given, which put it
 * directly over the rim of the rings and read as part of the ring system
 * rather than as a thing that had arrived beside it. The ring sheet ends at
 * 2.35 × 5.85 = 13.75, so it now sits about a ring-width clear of the edge.
 *
 * The clearances that matter, all of them in this frame: the ring sheet is
 * 21.6 away, Titan — the outermost moon, at 20.7 — is 18.1 at its closest
 * approach, and Mimas and Enceladus are further still. Outward it reaches
 * 16.4 units past Saturn in the orbital plane and 27.4 above it, so at
 * Saturn's own 144 the far edge of it is 160 from the sun, comfortably inside
 * the 172.4 where Uranus's rings begin. That last one is the constraint that
 * stops this going any further out: the two planets do line up. */
export const WORMHOLE: LandmarkSpec = {
  key: "wormhole",
  ko: "웜홀",
  en: "Wormhole",
  bodyKo: "웜홀",
  bodyEn: "Wormhole",
  to: "",
  position: [27, 17, 0],
};

/** The Endurance — Interstellar's ship, not Voyager 1.
 *
 * It replaced the probe when the grand tour stopped being a survey of the
 * outer system and became a run at the wormhole: a craft that coasts outward
 * on momentum it spent thirty years accumulating is the wrong vehicle for a
 * route that ends by flying into something.
 *
 * The export keeps its old name, and so does the key. The key is what the
 * scene, the label layer and every analytics row already call this object,
 * and renaming it would break the continuity of the second of those for a
 * string nobody sees. */
export const VOYAGER: LandmarkSpec = {
  key: "voyager",
  ko: "글로벌 뉴스",
  en: "GLOBAL NEWS",
  bodyKo: "인듀어런스호",
  bodyEn: "Endurance",
  to: "/news",
  // Not actually fixed — the ship coasts outward on its own track and this is
  // only where it starts. See the scene's rig.
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
 * from the front door.
 *
 * The hole goes last, after the neutron pair. It is the only stop that does
 * not simply end when its ten seconds are up — the tour falls into it, and the
 * screen goes with it (see HubScene.updateFinale). That has to be the finish;
 * put it in the middle and the tour comes back from a blackout to carry on
 * looking at a planet, which is an ending followed by more. */
export const TOUR_ORDER: string[] = [
  /* Named rather than taken from PLANETS, because it is no longer all of them:
     the tour opens at Earth. Mercury and Venus are close in and small, and two
     stops on grey rock before the tour has said anything is where a visitor
     decides it is a screensaver. Starting at the one body everybody can place
     buys the other six their attention. */
  "earth",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  NEUTRON_BINARY.key,
  BLACK_HOLE.key,
];

/** Pluto: not a destination. It drifts in from the black hole's left, is torn
 * apart by it, and the cycle repeats — the type-1 hub's signature event, kept.
 * (It is also, by the IAU's 2006 reckoning, no longer a planet, which is the
 * joke.) */
export const PLUTO_TEXTURE = `${TEX}/pluto.webp`;
export const SUN_TEXTURE = `${TEX}/sun.webp`;
