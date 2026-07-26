import { useEffect, useMemo, useRef, useState } from "react";
import { GlobalIndexWidget, IndexQuote, api } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link, navigate } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import { PhotoPlanetBody, PhotoSkin, RocketCraft, StarBody, VoyagerCraft } from "./CelestialBody";
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
      ringed: true,
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
      // full barrel-roll is out of scope for this billboard).
      reverseSpin: true,
      glow: "#8fe9e0",
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
    parts.push(`${x}px ${y}px 0 ${size}px rgba(255,255,255,${alpha})`);
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

   Two kinds:
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
     which reads ?code= itself) per an explicit request for that destination. */

interface MoonSpec {
  key: string;
  to: string;
  ko: string;
  en: string;
  /** Added to the host planet's own rendered radius, in px, so the orbit
   * always clears the planet regardless of viewport scale (both are in the
   * same --size / --body-unit units via the CSS calc in .hb-moon-arm). */
  offsetPx: number;
  durationSeconds: number;
  phase: number;
  kind: "stock" | "rocket";
  /** Stock code for StockIcon — only set when kind is "stock". */
  code?: string;
}

const EARTH_MOONS: MoonSpec[] = [
  { key: "samsung", to: "/dashboard?code=005930", ko: "삼성전자", en: "Samsung", offsetPx: 33, durationSeconds: 7, phase: 0, kind: "stock", code: "005930" },
  { key: "skhynix", to: "/dashboard?code=000660", ko: "SK하이닉스", en: "SK hynix", offsetPx: 59, durationSeconds: 11, phase: 0.5, kind: "stock", code: "000660" },
];

// "/global?code=SPCX" rather than the full production URL — GlobalStockPage
// (App.tsx's "/global" route) already reads ?code= itself, and a relative
// path keeps this working through the SPA's own navigate() in local dev too;
// a hardcoded https://kospi-predictor.onrender.com/... would send local
// testing off to the live site instead of whatever's actually running here.
const MARS_MOONS: MoonSpec[] = [
  { key: "spacex", to: "/global?code=SPCX", ko: "SpaceX", en: "SpaceX", offsetPx: 24, durationSeconds: 9, phase: 0.25, kind: "rocket" },
];

function Moonlet({ spec, en, onOpen }: { spec: MoonSpec; en: boolean; onOpen: (to: string) => void }) {
  const label = en ? spec.en : spec.ko;
  const delay = `${-spec.durationSeconds * spec.phase}s`;
  const style = {
    "--md": `${spec.durationSeconds}s`,
    "--mdelay": delay,
    "--mr": `${spec.offsetPx}px`,
  } as React.CSSProperties;

  return (
    <div className="hb-moon-orbiter" style={style}>
      <div className="hb-moon-arm">
        <div className="hb-moon-face">
          <button
            type="button"
            className={spec.kind === "rocket" ? "hb-moon hb-moon--rocket" : "hb-moon"}
            onClick={() => onOpen(spec.to)}
            aria-label={`${en ? "Satellite" : "위성"}: ${label}`}
            title={label}
          >
            {spec.kind === "rocket" ? (
              <RocketCraft />
            ) : (
              <>
                <span className="hb-moon-wing hb-moon-wing--l" />
                <StockIcon code={spec.code!} className="hb-moon-logo" />
                <span className="hb-moon-wing hb-moon-wing--r" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
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

              {PLANETS.map((spec) => (
                <Planet
                  key={spec.key}
                  spec={spec}
                  change={spec.feed ? feed[spec.feed] : null}
                  en={en}
                  onOpen={open}
                />
              ))}
            </div>

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
