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
 * Two shapes, one set of numbers. The desktop LED cabinet is a tall fixed-width block
 * that only fits beside a wide header, so below `HUD_QUERY` the same readings re-lay
 * themselves as a full-width HUD band: the date and sky on one line, then one wide row
 * per city with digits big enough to read at arm's length. The narrow viewport used to
 * get nothing at all here, which is the one place the information is hardest to come by
 * otherwise. */

/** Where the cabinet gives way to the band. Matches the width at which the header's
 * search + shortcuts claim the whole row — past it there is no column left to stand a
 * 228px cabinet in. Lives in JS rather than CSS because the two shapes are different
 * trees, not the same tree restyled. */
const HUD_QUERY = "(max-width: 820px)";

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

/** Session state for one city: whether it is trading now, and how far through the day's
 * session the clock has travelled (0 before the bell, 1 after the close, 0 all weekend).
 * The progress figure is what the HUD's hairline rail under each clock draws. */
function session(now: Date, tz: string): { open: boolean; progress: number } {
  const p = parts(now, tz, { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  if (p.weekday === "Sat" || p.weekday === "Sun") return { open: false, progress: 0 };
  const [start, end] = SESSIONS[tz];
  const mins = (Number(p.hour) % 24) * 60 + Number(p.minute);
  return {
    open: mins >= start && mins < end,
    progress: Math.min(1, Math.max(0, (mins - start) / (end - start))),
  };
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

export default function HeaderDateTime() {
  const { lang } = useLanguage();
  const isHud = useMediaQuery(HUD_QUERY);
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
    { key: SEOUL, label: lang === "ko" ? "서울" : "SEOUL", flag: "/img/flag/kr.svg", session: session(now, SEOUL) },
    { key: NY, label: lang === "ko" ? "뉴욕" : "NEW YORK", flag: "/img/flag/us.svg", session: session(now, NY) },
  ];

  // KRX session state drives the cabinet's status pip (green live / red closed) and its
  // label; the HUD gives every city its own instead.
  const krxOpen = cities[0].session.open;

  /* ── The narrow shape. Same readings, re-laid as a full-width band ──────────────────
     The cabinet's vertical stack (topbar / date / two clock rows) needs a fixed 228px
     column it cannot have here, so the band spends the width it does have instead: the
     date, sky and temperature share one head line, and each city gets a whole row to
     itself — flag and session state on the left, day/night glyph and big dot-matrix time
     on the right, over a hairline rail that fills as that market's session runs. Reading
     a phone at arm's length is the whole reason the digits are larger here than in the
     cabinet, not smaller. */
  if (isHud) {
    return (
      <div className="hud" role="group" aria-label={lang === "ko" ? "시각 · 날씨" : "Clocks and weather"}>
        <div className="hud-panel">
          <div className="hud-corners" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
          {/* A slow sweep down the glass — the one moving element that makes the band
              read as a live display rather than a printed strip. */}
          <span className="hud-scan" aria-hidden="true" />

          <div className="hud-head">
            <span className={`led-big ${weekendTone}`}>{day}</span>
            <span className="hud-headmeta">
              <span className={`led-weekday ${weekendTone}`}>{weekday}</span>
              <span className="led-monthday">
                {monthEn} {year}
              </span>
            </span>
            {weather && (
              <span className="hud-wx">
                <WeatherIcon type={wxType(weather.code)} day={weather.is_day} />
                <span className="hud-wxread">
                  <span className="led-temp">{weather.temperature}°</span>
                  <span className="hud-wxcity">{lang === "ko" ? "서울" : "SEOUL"}</span>
                </span>
              </span>
            )}
          </div>

          <div className="hud-clocks">
            {cities.map((c) => (
              <div className="hud-row" key={c.key}>
                <span className="hud-city">
                  <img className="led-flag" src={c.flag} alt="" />
                  {c.label}
                </span>
                <span className={`hud-state${c.session.open ? " is-open" : ""}`}>
                  <span className={`led-dot${c.session.open ? " is-open" : ""}`} />
                  {label(c.session.open)}
                </span>
                <span className="hud-time">
                  <DayNightIcon day={isDaytime(now, c.key)} />
                  <LedClock text={clock(now, c.key)} />
                  <span className="led-tz">{tzAbbr(now, c.key)}</span>
                </span>
                <span className="hud-rail" aria-hidden="true">
                  <i
                    className={c.session.open ? "is-live" : ""}
                    style={{ width: `${c.session.progress * 100}%` }}
                  />
                </span>
              </div>
            ))}
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
