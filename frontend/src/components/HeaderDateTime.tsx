import { Fragment, useEffect, useState } from "react";
import { api } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { useMediaQuery } from "../useMediaQuery";

/** An airport split-flap departure-board rendered date/clock block for the empty right
 * side of the dashboard header strip.
 *
 * The date and weekday follow Korea (the site's home market); two live clocks below
 * carry Seoul and New York, the two sessions a KR investor watches, laid out like flight
 * times; and a small weather glyph beside the date reports Seoul's current sky. Times are
 * derived with Intl in the given time zone, so they stay correct wherever the visitor's
 * own clock is set and flip DST on their own.
 *
 * Two designs, one set of readings. Below `HUD_QUERY` this is not the cabinet made
 * narrow — it is a different instrument built from the same numbers, because a phone
 * asks a different question. The cabinet's job is to sit in the corner of a wide screen
 * and be glanced at; the band's job is to answer "is anything trading, and when is the
 * next bell" on a device that already draws its own clock. See the comment on the narrow
 * branch below for what that changes. */

/** Where the cabinet gives way to the band. Matches the width at which the header's
 * search + shortcuts claim the whole row — past it there is no column left to stand a
 * 228px cabinet in. Lives in JS rather than CSS because the two shapes are different
 * trees, not the same tree restyled. */
const HUD_QUERY = "(max-width: 820px)";
const FOLD_LANDSCAPE_HUD_QUERY =
  "(max-width: 719px), " +
  "(max-width: 820px) and (orientation: portrait), " +
  "(max-width: 820px) and (max-height: 499px)";

function parts(now: Date, tz: string, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).formatToParts(now)) {
    out[p.type] = p.value;
  }
  return out;
}

function clock(now: Date, tz: string): string {
  // 24-hour, zero-padded — the read a trading clock wants, no AM/PM to parse.
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
}

function tzAbbr(now: Date, tz: string): string {
  return parts(now, tz, { timeZoneName: "short" }).timeZoneName ?? "";
}

/** 6am–6pm reads as day. Used only to pick a sun/moon glyph beside each city. */
function isDaytime(now: Date, tz: string): boolean {
  const h = Number(parts(now, tz, { hour: "2-digit", hour12: false }).hour) % 24;
  return h >= 6 && h < 18;
}

const SEOUL = "Asia/Seoul";
const NY = "America/New_York";

/** Each city's regular session, as minutes-from-local-midnight. KRX 09:00–15:30 KST,
 * NYSE 09:30–16:00 ET. Both are local wall-clock ranges, so reading them against a
 * time already converted into that zone gets DST right for free. Holidays aren't
 * tracked, so a holiday still reads as "open" during those hours — good enough for a
 * live/closed pip. */
const SESSIONS: Record<string, [number, number]> = {
  [SEOUL]: [9 * 60, 15 * 60 + 30],
  [NY]: [9 * 60 + 30, 16 * 60],
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Seconds since local midnight in a zone, plus the local weekday (0 = Sunday). */
function local(now: Date, tz: string): { sec: number; wd: number } {
  const p = parts(now, tz, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return {
    sec: (Number(p.hour) % 24) * 3600 + Number(p.minute) * 60 + Number(p.second),
    wd: WEEKDAYS.indexOf(p.weekday),
  };
}

type Market = {
  /** Trading right now. */
  open: boolean;
  /** How far through today's session, 0 before the bell and 1 after the close. */
  progress: number;
  /** Seconds until the next bell — the close if it is trading, otherwise the next open. */
  wait: number;
  event: "close" | "open";
};

/** What a market is doing and when it next changes. The wait is the figure the band
 * puts in its largest type, so it has to survive a Friday afternoon: from a Friday
 * close the next open is 65 hours away, and the scan below walks forward day by day
 * until it lands on a weekday rather than assuming tomorrow. */
function market(now: Date, tz: string): Market {
  const { sec, wd } = local(now, tz);
  const [startMin, endMin] = SESSIONS[tz];
  const start = startMin * 60;
  const end = endMin * 60;
  const weekday = wd >= 1 && wd <= 5;

  if (weekday && sec >= start && sec < end) {
    return { open: true, progress: (sec - start) / (end - start), wait: end - sec, event: "close" };
  }

  let wait: number;
  if (weekday && sec < start) {
    wait = start - sec;
  } else {
    let days = 1;
    while (((wd + days) % 7) === 0 || ((wd + days) % 7) === 6) days++;
    wait = 86400 - sec + (days - 1) * 86400 + start;
  }
  return { open: false, progress: weekday && sec >= end ? 1 : 0, wait, event: "open" };
}

/* ── The trading-day axis ───────────────────────────────────────────────────────────
   Both sessions are drawn on one shared timeline, in Seoul time, because that is the
   day a KR investor actually has: KRX in the morning, New York overnight. The axis
   starts at 08:00 KST — after New York has closed and before Seoul opens — which is
   the one cut in the 24 hours that leaves both sessions whole. On a midnight-to-
   midnight axis the New York bar would be sliced in two and drawn at both ends. */
const AXIS_START = 8 * 60;

function zoneMins(now: Date, tz: string): number {
  const p = parts(now, tz, { hour: "2-digit", minute: "2-digit", hour12: false });
  return (Number(p.hour) % 24) * 60 + Number(p.minute);
}

/** Where a Seoul minute-of-day sits on the axis, 0–1. */
function axisPos(mins: number): number {
  return ((((mins - AXIS_START) % 1440) + 1440) % 1440) / 1440;
}

function hhmm(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** A market's session projected onto the Seoul axis: where its bar starts and ends,
 * and the Seoul wall-clock times those two edges are — which is the reading worth
 * having, since "New York opens at 22:30 our time" is the useful form of 09:30 ET.
 * The shift is measured from the two live clocks rather than hard-coded, so the bar
 * slides the hour it should twice a year without anyone touching this. */
function lane(now: Date, tz: string) {
  const [startMin, endMin] = SESSIONS[tz];
  const shift =
    tz === SEOUL ? 0 : ((((zoneMins(now, SEOUL) - zoneMins(now, tz)) % 1440) + 1440) % 1440);
  return {
    from: axisPos(startMin + shift),
    to: axisPos(endMin + shift),
    openAt: hhmm(startMin + shift),
    closeAt: hhmm(endMin + shift),
  };
}

/** The countdown, in the largest unit that still says something. Seconds matter when
 * the bell is minutes away and are noise when it is two days away, so past a day it
 * drops to days and hours and stops twitching. */
function countdown(sec: number, ko: boolean): string {
  if (sec >= 86400) {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    return ko ? `${d}일 ${h}시간` : `${d}d ${h}h`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type Wx = "clear" | "partly" | "cloudy" | "fog" | "rain" | "snow" | "thunder";

/** Collapse the WMO weather-interpretation code Open-Meteo returns into the handful
 * of icons worth drawing at this size. */
function wxType(code: number): Wx {
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "thunder";
  return "rain"; // drizzle / rain / showers / freezing rain
}

const CLOUD = "M8 15.5h9a3.2 3.2 0 0 0 .3-6.38A4.6 4.6 0 0 0 8.5 8 3.75 3.75 0 0 0 8 15.5Z";

/** Sun / moon as a fixed-box inline SVG rather than the ☀/☾ emoji — the two glyphs
 * have different advance widths and side bearings, so emoji never line up in a column
 * however they're boxed; identical SVG viewBoxes do. */
function DayNightIcon({ day }: { day: boolean }) {
  return (
    <svg className="led-daynight" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
      {day ? (
        <g stroke="#e0a83a" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.5" fill="#eab34a" stroke="none" />
          <path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.2 5.2l1.9 1.9M16.9 16.9l1.9 1.9M18.8 5.2l-1.9 1.9M7.1 16.9l-1.9 1.9" />
        </g>
      ) : (
        /* Crescent whose bounding box is centred on the sun's (translate tuned so the
           moon sits directly under the sun, not shifted aside). */
        <path transform="translate(-1 0)" d="M20 13.2A8 8 0 1 1 10.8 4.2 6.3 6.3 0 0 0 20 13.2Z" fill="#c8cede" />
      )}
    </svg>
  );
}

/** Small inline weather glyph — colored so it reads at a glance (gold sun, blue rain)
 * rather than tinting to text color like the rest of the block. */
function WeatherIcon({ type, day }: { type: Wx; day: boolean }) {
  return (
    <svg className="led-wx" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      {type === "clear" && day && (
        <g stroke="#f5a623" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.2" fill="#f7b733" stroke="none" />
          <path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" />
        </g>
      )}
      {type === "clear" && !day && (
        <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" fill="#cdd6e5" />
      )}
      {type === "partly" && (
        <>
          <g stroke="#f5a623" strokeWidth="1.4" strokeLinecap="round">
            <circle cx="8.5" cy="8" r="3" fill="#f7b733" stroke="none" />
            <path d="M8.5 1.8v1.8M2.3 8h1.8M4.1 3.6l1.3 1.3M12.9 3.6l-1.3 1.3" />
          </g>
          <path d={CLOUD} fill="#c3cad6" />
        </>
      )}
      {type === "cloudy" && <path d={CLOUD} fill="#b4bcc8" />}
      {type === "fog" && (
        <>
          <path d={CLOUD} fill="#b4bcc8" />
          <g stroke="#9aa3b1" strokeWidth="1.5" strokeLinecap="round">
            <path d="M5 18.5h11M7 21h9" />
          </g>
        </>
      )}
      {type === "rain" && (
        <>
          <path d={CLOUD} fill="#aeb7c5" />
          <g stroke="#4a90d9" strokeWidth="1.6" strokeLinecap="round">
            <path d="M8.5 17.5l-1 2.6M12 17.5l-1 2.6M15.5 17.5l-1 2.6" />
          </g>
        </>
      )}
      {type === "snow" && (
        <>
          <path d={CLOUD} fill="#aeb7c5" />
          <g fill="#7fb2e6">
            <circle cx="8.5" cy="19" r="1" />
            <circle cx="12" cy="20" r="1" />
            <circle cx="15.5" cy="19" r="1" />
          </g>
        </>
      )}
      {type === "thunder" && (
        <>
          <path d={CLOUD} fill="#aeb7c5" />
          <path d="M12.5 16.5l-3 4h2.2l-1 3.2 3.3-4.4h-2.2l1-2.8Z" fill="#f5c518" />
        </>
      )}
    </svg>
  );
}

/** Render an "HH:MM:SS" time as LED dot-matrix segments with blinking colons between
 * them — each numeric group and colon becomes a masked (dotted) glyph on the sign. */
function LedClock({ text }: { text: string }) {
  const segs = text.split(":");
  return (
    <span className="led-clock">
      {segs.map((seg, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="led-col">:</span>}
          <span className="led-seg">{seg}</span>
        </Fragment>
      ))}
    </span>
  );
}

export default function HeaderDateTime({ desktopOnFoldLandscape = false }: { desktopOnFoldLandscape?: boolean }) {
  const { lang } = useLanguage();
  const isHud = useMediaQuery(desktopOnFoldLandscape ? FOLD_LANDSCAPE_HUD_QUERY : HUD_QUERY);
  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState<{ temperature: number; code: number; is_day: boolean } | null>(null);

  useEffect(() => {
    // The tick now runs on phones as well, so it stands down while the tab is hidden
    // rather than waking a backgrounded handset once a second to redraw a clock nobody
    // is looking at — and re-reads the time on the way back, since the seconds that
    // passed in between were never rendered.
    let id: number | undefined;
    const start = () => {
      if (id !== undefined) return;
      setNow(new Date());
      id = window.setInterval(() => setNow(new Date()), 1000);
    };
    const stop = () => {
      window.clearInterval(id);
      id = undefined;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .seoulWeather()
        .then((w) => alive && setWeather(w))
        .catch(() => {
          // A missed fetch just leaves the last sky (or no glyph) — never blocks the clock.
        });
    load();
    const stop = startVisibilityAwareInterval(load, 15 * 60 * 1000);
    return () => {
      alive = false;
      stop();
    };
  }, []);

  const dp = parts(now, SEOUL, { year: "numeric", month: "short", day: "numeric", weekday: "short" });
  const monthEn = dp.month.toUpperCase();
  // Korean writes the month as a number ("8월"), so the band needs it alongside the
  // short English name the cabinet sets in its own header.
  const monthNum = Number(parts(now, SEOUL, { month: "numeric" }).month);
  const day = dp.day;
  const year = dp.year;
  const weekdayEn = dp.weekday.toUpperCase();
  const weekdayKo = new Intl.DateTimeFormat("ko-KR", { timeZone: SEOUL, weekday: "long" }).format(now);
  const weekday = lang === "ko" ? weekdayKo : weekdayEn;

  // Korean calendar convention: Sunday numbers in red, Saturday in blue.
  const weekendTone = weekdayEn === "SUN" ? "is-sun" : weekdayEn === "SAT" ? "is-sat" : "";

  const label = (open: boolean) =>
    open ? (lang === "ko" ? "장중" : "OPEN") : lang === "ko" ? "장마감" : "CLOSED";

  const cities = [
    { key: SEOUL, label: lang === "ko" ? "서울" : "SEOUL", flag: "/img/flag/kr.svg" },
    { key: NY, label: lang === "ko" ? "뉴욕" : "NEW YORK", flag: "/img/flag/us.svg" },
  ];

  const kr = market(now, SEOUL);
  const us = market(now, NY);
  const krxOpen = kr.open;

  /* ── The narrow shape: everything, in two rows ──────────────────────────────────────
     This is ambient information — worth a glance, not worth a panel — so it gets two
     rows and about 57px, down from the 175 the first attempt spent. Nothing was dropped
     to get there; the rows were made to carry two things each.

     Row one is the readings: date and sky on the left, both wall clocks on the right.
     Row two is the day: a hairline track running the full width with the next bell
     counted down at the end of it.

     The track is what makes two rows enough. On a Seoul-time axis the two sessions
     never overlap — KRX runs 09:00–15:30, New York 22:30–05:00 the next morning — so
     both blocks fit one track with no ambiguity about which is which, and the whole
     trading day costs six pixels of height. A mark rides it at now; where that mark
     sits against the two blocks is the status report.

     Colour does the rest of the work that words would otherwise need: Seoul amber, New
     York cyan, and the market that is trading is the one that is lit — its block on the
     track, its clock on the row above, and the countdown if it is the one being counted.
     Nothing else in the strip is coloured, so "lit" means "live" with no legend. */
  const focus = kr.open ? kr : us.open ? us : kr.wait <= us.wait ? kr : us;
  const focusTone = focus === kr ? "is-kr" : "is-us";
  // "NEW YORK" is the cabinet's label and too long for this slot; the strip uses NY.
  const focusCity =
    focus === kr ? (lang === "ko" ? "서울" : "SEOUL") : lang === "ko" ? "뉴욕" : "NY";
  // Short forms: this label sits at the end of a hairline with the figure beside it, and
  // "서울 마감" in that slot says everything "서울 장 마감까지" would.
  const focusVerb =
    focus.event === "close" ? (lang === "ko" ? "마감" : "close") : lang === "ko" ? "개장" : "open";

  const lanes = [
    { ...cities[0], tone: "is-kr", mkt: kr, geom: lane(now, SEOUL) },
    { ...cities[1], tone: "is-us", mkt: us, geom: lane(now, NY) },
  ];

  if (isHud) {
    return (
      <div
        className="hud"
        role="group"
        aria-label={lang === "ko" ? "장 시간 · 시각 · 날씨" : "Market hours, clocks and weather"}
      >
        <div className="hud-deck">
          <div className="hud-line">
            <span className={`hud-date ${weekendTone}`}>
              {lang === "ko" ? `${monthNum}월 ${day}일` : `${monthEn} ${day}`}
              <span className="hud-dow">{weekday}</span>
            </span>

            {weather && (
              <span className="hud-sky">
                <WeatherIcon type={wxType(weather.code)} day={weather.is_day} />
                <span className="hud-temp">{weather.temperature}°</span>
              </span>
            )}

            {/* Each clock carries its market's state as well as its time: the trading
                one is lit in its own colour, the other sits in slate. Seconds are their
                own element so the narrowest phones can drop them and keep hour:minute
                at full size rather than shrinking the whole clock to fit. */}
            <span className="hud-clocks">
              {lanes.map((l) => (
                <span key={l.key} className={`hud-clock ${l.tone}${l.mkt.open ? " is-live" : ""}`}>
                  <img className="hud-flag" src={l.flag} alt="" />
                  <span className="hud-hm">{clock(now, l.key).slice(0, 5)}</span>
                  <span className="hud-sec">{clock(now, l.key).slice(5)}</span>
                </span>
              ))}
            </span>
          </div>

          <div className="hud-line hud-line--day">
            {/* Blocks are placed in percent of the axis, so the geometry is the data. */}
            <span className="hud-rail">
              {lanes.map((l) => (
                <span
                  key={l.key}
                  className={`hud-win ${l.tone}${l.mkt.open ? " is-live" : ""}`}
                  style={{ left: `${l.geom.from * 100}%`, width: `${(l.geom.to - l.geom.from) * 100}%` }}
                >
                  <i style={{ width: `${l.mkt.progress * 100}%` }} />
                </span>
              ))}
              <span
                className="hud-mark"
                aria-hidden="true"
                style={{ left: `${axisPos(zoneMins(now, SEOUL)) * 100}%` }}
              />
            </span>

            {/* The next bell, at the end of the track it belongs to. Past a day it drops
                to days and hours — counting 65 hours down in seconds is a twitch, not a
                reading — which is also what keeps this from growing a digit on Friday. */}
            <span className={`hud-next ${focusTone}`}>
              <span className="hud-next-label">
                {focusCity} {focusVerb}
              </span>
              <span className="hud-next-value">{countdown(focus.wait, lang === "ko")}</span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="led" aria-hidden="true">
      <div className="led-cabinet">
        <div className="led-corners">
          <i />
          <i />
          <i />
          <i />
        </div>

        <div className="led-screen">
          <div className="led-topbar">
            <span className="led-brand">
              <span className={`led-dot${krxOpen ? " is-open" : ""}`} />
              {label(krxOpen)}
            </span>
            <span className="led-sub">
              {monthEn} {year}
            </span>
          </div>

          <div className="led-date">
            <span className={`led-big ${weekendTone}`}>{day}</span>
            <div className="led-datemeta">
              <span className={`led-weekday ${weekendTone}`}>{weekday}</span>
              <span className="led-monthday">
                {monthEn} {day}
              </span>
            </div>
            {weather && (
              <span className="led-weather" title={`서울 ${weather.temperature}°C`}>
                <WeatherIcon type={wxType(weather.code)} day={weather.is_day} />
                <span className="led-temp">{weather.temperature}°</span>
              </span>
            )}
          </div>

          {/* A 2-column grid (city | time) rather than a row per city, so both cities'
              LED time blocks pin to the same right edge — the two clocks read as an
              aligned column. */}
          <div className="led-rows">
            {cities.map((c) => (
              <Fragment key={c.key}>
                <span className="led-city">
                  <img className="led-flag" src={c.flag} alt="" />
                  {c.label}
                </span>
                <span className="led-time">
                  <DayNightIcon day={isDaytime(now, c.key)} />
                  <LedClock text={clock(now, c.key)} />
                  <span className="led-tz">{tzAbbr(now, c.key)}</span>
                </span>
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
