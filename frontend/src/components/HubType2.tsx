import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GlobalIndexWidget, IndexQuote, api } from "../api/client";
import { DESTINATIONS, type FeedKey } from "../hub2/bodies";
import type { BodyInfo, FeedMap, Tier } from "../hub2/scene";
import { HubScene } from "../hub2/scene";
import { useLanguage } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link, navigate } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import LanguageToggle from "./LanguageToggle";
import ThemeToggle from "./ThemeToggle";
import "./hub2.css";

/* ============================================================================
   ORBIT II — the shell.
   ----------------------------------------------------------------------------
   Type 2 of the site's entrance, at /type2. The original at "/" builds its
   solar system out of CSS 3D transforms; this one hands the whole scene to
   WebGL and keeps React for what React is actually good at here — polling two
   endpoints, holding the language, and rendering a HUD of real, focusable
   controls over the top of it.

   The division of labour is strict, and it is the reason this page can hold
   sixty frames while showing live data:

     scene.ts   owns every pixel inside the canvas, plus the floating body
                labels (its own DOM, written with direct transform
                assignments). Nothing in it re-renders React.
     this file  owns everything that is text, every control that is a button,
                and the data. It talks to the scene through imperative methods
                on a ref, never through props that would re-render it.

   Every destination in the sky is also a real <button> in the dock below and
   a real <a> in the crawler nav at the bottom, so nothing here is reachable
   only by pointing at a moving object in a 3D scene.
   ========================================================================= */

const INDEX_POLL_MS = 30_000;

const EMPTY_FEED: FeedMap = { KOSPI: null, KOSDAQ: null, SPX: null, NDX: null };

/* ───────────────────────────── clocks ───────────────────────────── */

function useTick(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function Clock({ code, zone, now }: { code: string; zone: string; now: Date }) {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  return (
    <div className="h2-clock">
      <span className="h2-clock-code">{code}</span>
      <span className="h2-clock-time">{time}</span>
    </div>
  );
}

/* ───────────────────────────── helpers ───────────────────────────── */

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function toneOf(value: number | null | undefined): "up" | "down" | "flat" {
  if (value === null || value === undefined) return "flat";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

/* ───────────────────────────── the page ───────────────────────────── */

export default function HubType2() {
  const { lang } = useLanguage();
  const en = lang === "en";
  // Plain, now that this is the site's front door rather than a second one.
  useDocumentTitle("K-Stock Hub");

  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HubScene | null>(null);
  /* The scene reads these on the frame it needs them. Kept in refs as well as
     in state because the scene's callbacks fire outside React's world and must
     not close over a stale render. */
  const feedRef = useRef<FeedMap>(EMPTY_FEED);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState<BodyInfo | null>(null);
  /* The body the camera has taken as its pivot. Two things depend on it: the
     prompt telling the visitor a second tap will open it, and the "release"
     control that hands the camera back to the whole system. */
  const [focused, setFocused] = useState<BodyInfo | null>(null);
  const [tier, setTier] = useState<Tier>("ultra");
  const [tour, setTour] = useState(false);
  /* The probe's grand tour. Separate from `tour` and mutually exclusive with
     it — both drive the camera, so turning one on has to turn the other off,
     and the scene enforces that too for the case where the tour is started by
     tapping the craft in the sky rather than by pressing this. */
  const [probeTour, setProbeTour] = useState(false);
  /* The scene has taken the whole frame — blacked out, or holding the plate at
     the end of the tour. Everything in this component except the canvas is DOM
     on top of it, so none of it goes dark when the render does; it has to be
     told to stand down. */
  const [curtain, setCurtain] = useState(false);
  const [kospi, setKospi] = useState<IndexQuote | null>(null);
  const [kosdaq, setKosdaq] = useState<IndexQuote | null>(null);
  const [globals, setGlobals] = useState<GlobalIndexWidget[]>([]);
  const now = useTick();

  /* ── data: two cached endpoints, one poll — the same budget the type-1
        entrance runs on, because the point of an entrance is the entrance ── */
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
          // A missed refresh leaves the sky showing its last known move.
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

  const feed = useMemo<FeedMap>(() => {
    const bySymbol = new Map<string, number | null>();
    globals.forEach((item) => {
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

  const status = useMemo(() => {
    const raw = (kospi?.market_status ?? kosdaq?.market_status ?? "").toUpperCase();
    if (raw === "OPEN") return { label: en ? "MARKET OPEN" : "장중", tone: "open" };
    if (raw === "PREOPEN") return { label: en ? "PRE-OPEN" : "장 시작 전", tone: "pre" };
    if (raw === "CLOSE") return { label: en ? "MARKET CLOSED" : "장 마감", tone: "closed" };
    return { label: en ? "CONNECTING" : "연결 중", tone: "sync" };
  }, [kospi, kosdaq, en]);

  /* ── the scene. Built once, on mount, and torn down completely on unmount:
        a WebGL context that outlives its component is a leak the browser will
        eventually punish by refusing to give out another one. ── */
  const handleSelect = useCallback((body: BodyInfo) => {
    navigate(body.to);
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    /* `?tier=low|high|ultra` pins the quality tier instead of letting the
       scene measure its own frame rate and settle on one. Only ever a
       debugging aid — it is how the expensive tier gets exercised on a
       machine that would otherwise be demoted off it within two seconds, and
       how the cheap tier gets looked at on a machine that never would be. */
    const forced = new URLSearchParams(window.location.search).get("tier");
    const tier = forced === "low" || forced === "high" || forced === "ultra" ? forced : undefined;

    let scene: HubScene | null = null;
    try {
      scene = new HubScene(mount, {
        onHover: (body) => setHovered(body),
        onSelect: handleSelect,
        onFocus: (body) => setFocused(body),
        onReady: () => setReady(true),
        onTier: (next) => setTier(next),
        /* The scene starts and stops this one itself — a tap on the craft, or
           the tour running out at Neptune — so the button has to follow it
           rather than the other way round. */
        onVoyagerTour: (on) => setProbeTour(on),
        onCurtain: (on) => setCurtain(on),
      }, tier);
      if (tier) setTier(tier);
    } catch (error) {
      // No WebGL, a lost context on creation, a driver that refuses the
      // half-float target — none of which should leave a visitor staring at a
      // black rectangle. The fallback below is a complete, plain site map.
      console.error("ORBIT II: scene failed to start", error);
      setFailed(true);
      return;
    }

    sceneRef.current = scene;
    scene.setFeed(feedRef.current);
    return () => {
      scene?.dispose();
      sceneRef.current = null;
    };
  }, [handleSelect]);

  /* Push data and language down imperatively. These are the only two channels
     from React into the scene, and neither of them re-renders anything. */
  useEffect(() => {
    feedRef.current = feed;
    sceneRef.current?.setFeed(feed);
  }, [feed]);

  useEffect(() => {
    sceneRef.current?.setLang(lang);
  }, [lang]);

  useEffect(() => {
    sceneRef.current?.setTour(tour);
  }, [tour]);

  useEffect(() => {
    sceneRef.current?.setVoyagerTour(probeTour);
  }, [probeTour]);

  const dock = useMemo(
    () =>
      DESTINATIONS.map((d) => ({
        ...d,
        value: d.feed ? feed[d.feed as FeedKey] : null,
      })),
    [feed]
  );

  /* The dock flies the camera to the body first and lets the scene call back
     to navigate on arrival, so choosing from the dock and tapping the body
     itself are the same journey. `selectByKey` returns false when the dock
     lists something the sky does not (it is data-driven and the sky is not),
     in which case there is nothing to fly to and the route opens directly. */
  const openDestination = (key: string, to: string) => {
    if (!sceneRef.current?.selectByKey(key)) navigate(to);
  };

  if (failed) {
    return (
      <div className="h2 is-fallback">
        <div className="h2-fallback">
          <h1 className="h2-wordmark">
            <Link to="/dashboard" className="h2-wordmark-link">
              <span className="h2-wordmark-main">K-STOCK</span>
              <span className="h2-wordmark-sub">HUB</span>
            </Link>
          </h1>
          <p className="h2-fallback-note">
            {en
              ? "Your browser could not start the 3D view. Everything is still one click away."
              : "이 브라우저에서는 3D 화면을 실행할 수 없습니다. 모든 메뉴는 아래에서 바로 이동할 수 있습니다."}
          </p>
          <ul className="h2-fallback-list">
            {DESTINATIONS.map((d) => (
              <li key={d.key}>
                <Link to={d.to} style={{ ["--accent" as string]: d.accent }}>
                  {en ? d.en : d.ko}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className={`h2${ready ? " is-ready" : ""}${curtain ? " is-curtained" : ""}`}>
      {/* The scene owns this element's contents entirely — the canvas and the
          floating body labels. React must never touch what is inside it. */}
      <div className="h2-stage" ref={mountRef} />

      {/* ── the arrival curtain ── */}
      <div className="h2-boot" aria-hidden={ready}>
        <div className="h2-boot-mark">
          <span className="h2-boot-ring" />
          <span className="h2-boot-core" />
        </div>
        <p className="h2-boot-text">{en ? "ENTERING ORBIT" : "궤도 진입 중"}</p>
      </div>

      {/* ── top left: identity and market state ── */}
      <header className="h2-lockup">
        <span className={`h2-status is-${status.tone}`}>
          <span className="h2-status-dot" aria-hidden="true" />
          {status.label}
        </span>
        <h1 className="h2-wordmark">
          <Link to="/dashboard" className="h2-wordmark-link">
            <span className="h2-wordmark-main">K-STOCK</span>
            <span className="h2-wordmark-sub">HUB</span>
          </Link>
        </h1>
        <p className="h2-tagline">
          {en ? "Every market signal, in one place." : "증시의 모든 정보가 여기서 만납니다"}
        </p>
      </header>

      {/* ── top right: chrome ── */}
      <div className="h2-chrome">
        <div className="h2-clocks" aria-hidden="true">
          <Clock code="SEO" zone="Asia/Seoul" now={now} />
          <Clock code="NYC" zone="America/New_York" now={now} />
        </div>
        <div className="h2-toggles">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </div>

      {/* ── left rail: the four live indices, as numbers rather than as glow ──
             The sky carries the same four moves, but a percentage you have to
             read off a planet's colour is a percentage nobody reads. */}
      {/* No SPX row. The backend's /global/indices widget does not carry the
          S&P 500 at all (it serves the Dow, the Nasdaq composite, two leveraged
          ETFs and the overseas majors), so that row could only ever print a
          dash — and a permanently empty number in a live readout reads as a
          broken feed. Jupiter and its dock button still open /sp500-map: the
          destination exists, the quote does not. */}
      <aside className="h2-readout" aria-label={en ? "Live indices" : "실시간 지수"}>
        {(["KOSPI", "KOSDAQ", "NDX"] as FeedKey[]).map((key) => {
          const value = feed[key];
          const label = key === "NDX" ? "NASDAQ 100" : key;
          return (
            <div key={key} className={`h2-readout-row is-${toneOf(value)}`}>
              <span className="h2-readout-name">{label}</span>
              <span className="h2-readout-val">{pct(value)}</span>
            </div>
          );
        })}
      </aside>

      {/* ── the body under the pointer, or the one the camera is holding:
             parked in a fixed spot so it never fights the label the scene
             already draws on the body itself, and so it does not jitter on
             touch. The focused body wins, because that is the one whose next
             tap does something irreversible. ──

             This is also the only place the two-step rule is spelled out. A
             visitor who taps Jupiter and finds the camera has flown to it
             rather than opened it needs to be told, once, what the second tap
             will do — otherwise the page just looks like it ignored them. */}
      {(() => {
        const shown = focused ?? hovered;
        if (!shown) return <div className="h2-focus" aria-live="polite" />;
        const isFocused = focused?.key === shown.key;
        return (
          <div
            className={`h2-focus is-on${isFocused ? " is-locked" : ""}`}
            /* On the card, not just the dot: the locked state tints its own
               border and glow with it too. */
            style={{ ["--accent" as string]: shown.accent }}
            aria-live="polite"
          >
            <span className="h2-focus-dot" aria-hidden="true" />
            {/* What it is, then where it goes. */}
            <span className="h2-focus-body">{en ? shown.bodyEn : shown.bodyKo}</span>
            <span className="h2-focus-name">{en ? shown.en : shown.ko}</span>
            {/* Same rule as the dock: a body whose quote does not exist shows
                no quote, rather than a dash where one would be. */}
            {shown.feed && feed[shown.feed] !== null && feed[shown.feed] !== undefined && (
              <span className={`h2-focus-val is-${toneOf(feed[shown.feed])}`}>{pct(feed[shown.feed])}</span>
            )}
            {isFocused && (
              <span className="h2-focus-hint">
                {en ? "Tap again to open" : "한 번 더 누르면 이동"}
              </span>
            )}
          </div>
        );
      })()}

      {/* ── camera controls ── */}
      <div className="h2-camera">
        <button
          type="button"
          className="h2-cam-btn"
          onClick={() => {
            setTour(false);
            setProbeTour(false);
            sceneRef.current?.resetCamera();
          }}
        >
          {/* Doubles as "let go of the body the camera is holding" — which is
              why it names that when there is one. */}
          {focused ? (en ? "RELEASE" : "포커스 해제") : en ? "RESET VIEW" : "시점 초기화"}
        </button>
        <button
          type="button"
          className={`h2-cam-btn${tour ? " is-on" : ""}`}
          aria-pressed={tour}
          onClick={() => {
            setProbeTour(false);
            setTour((on) => !on);
          }}
        >
          {en ? "AUTO TOUR" : "자동 여행"}
        </button>
        {/* The probe's own tour: Earth out to Neptune, a swing-by at each
            planet, camera riding behind the craft. Tapping Voyager in the sky
            does the same thing — this is here because the craft is a small
            object on a long orbit and is not always somewhere you can find it
            to tap. */}
        <button
          type="button"
          className={`h2-cam-btn h2-cam-btn--probe${probeTour ? " is-on" : ""}`}
          aria-pressed={probeTour}
          onClick={() => {
            setTour(false);
            setProbeTour((on) => !on);
          }}
        >
          {/* The label is its own element because the colour cycle is a
              gradient clipped to the glyphs, and the button already has a
              background of its own to keep. */}
          <span className="h2-cam-cycle">{en ? "VOYAGER TOUR" : "보이저호 여행"}</span>
        </button>
      </div>

      {/* ── the dock: every destination as a real button, live move included.
             This is the page's actual navigation. On a phone it is the primary
             way in; on a desktop it is the redundant one. Horizontally
             scrollable rather than wrapping, so it stays one row at any
             width. ── */}
      <nav className="h2-dock" aria-label={en ? "All sections" : "전체 메뉴"}>
        <ul className="h2-dock-rail">
          {dock.map((d) => (
            <li key={d.key}>
              <button
                type="button"
                className={`h2-dock-btn is-${toneOf(d.value)}`}
                style={{ ["--accent" as string]: d.accent }}
                onClick={() => openDestination(d.key, d.to)}
                onPointerEnter={() => sceneRef.current?.focusByKey(d.key)}
                onPointerLeave={() => sceneRef.current?.focusByKey(null)}
              >
                <span className="h2-dock-name">{en ? d.en : d.ko}</span>
                {/* On the value, not on whether the destination claims a feed.
                    Jupiter claims SPX and the backend's /global/indices widget
                    has never carried the S&P 500 — it serves the Dow, the
                    Nasdaq composite, two leveraged ETFs and the overseas
                    majors — so that button could only ever print a dash, and a
                    permanently empty number reads as a broken feed rather than
                    as an absent one. The left-hand readout already drops the
                    row for this reason; this is the same call. A feed that is
                    merely late still prints, because `value` is null only
                    until the poll lands. */}
                {d.value !== null && d.value !== undefined && (
                  <span className="h2-dock-val">{pct(d.value)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* The pointer half of this is new and not guessable: the wheel zooms at
          whatever is under the cursor, and the view can be moved off the sun
          entirely. Said plainly, because a visitor who does not know it is
          there is left with the old behaviour by default. */}
      <p className="h2-hint">
        {en
          ? "Drag to look around · scroll or pinch to zoom in on whatever you point at · right-drag, shift-drag or two fingers to move the view · tap a body to focus it, tap again to open"
          : "드래그로 시점 이동 · 휠/두 손가락으로 가리킨 곳을 확대 · 우클릭 드래그·Shift+드래그·두 손가락으로 보고 싶은 영역으로 이동 · 천체를 누르면 초점 이동, 한 번 더 누르면 해당 화면으로"}
      </p>

      {/* ESO licenses its images CC BY 4.0 and requires the credit line to be
          shown *visibly* — not merely in a source comment — so this is here
          rather than only in scene.ts. Deliberately quiet, but real text. */}
      <p className="h2-credit">
        {en ? "Milky Way panorama: " : "은하수 파노라마: "}
        <a href="https://www.eso.org/public/images/eso0932a/" target="_blank" rel="noreferrer noopener">
          ESO/S. Brunier
        </a>
        {en ? " · Horsehead Nebula: " : " · 말머리 성운: "}
        <a href="https://www.eso.org/public/images/eso0202a/" target="_blank" rel="noreferrer noopener">
          ESO
        </a>
        {" · CC BY 4.0"}
      </p>

      {tier !== "ultra" && (
        <p className="h2-tier" aria-hidden="true">
          {en ? `QUALITY · ${tier.toUpperCase()}` : `품질 · ${tier.toUpperCase()}`}
        </p>
      )}

      {/* Text routes to everything, outside the canvas. The bodies are
          clickable and the dock is focusable, but a crawler — and a reader on
          a screen reader skimming for links — should not have to infer a site
          map from a WebGL scene. */}
      <nav className="sr-only" aria-label={en ? "Site map" : "사이트맵"}>
        {DESTINATIONS.map((d) => (
          <Link key={d.key} to={d.to}>
            {en ? d.en : d.ko}
          </Link>
        ))}
      </nav>
    </div>
  );
}
