import { Fragment, useEffect, useState } from "react";
import { api } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { MOBILE_QUERY, useMediaQuery } from "../useMediaQuery";

/** A desk-calendar-style date/clock block for the empty right side of the dashboard
 * header strip. Desktop only — on a phone the header is already two lines of search +
 * shortcuts with no room to spare, so this declines to mount there (and stops its
 * per-second timer from running on the device that least wants a background tick).
 *
 * The date and weekday follow Korea (the site's home market); two live clocks below
 * carry Seoul and New York, the two sessions a KR investor watches; and a small
 * weather glyph beside the weekday reports Seoul's current sky. Times are derived with
 * Intl in the given time zone, so they stay correct wherever the visitor's own clock
 * is set and flip DST on their own. */
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
    <svg className="deskcal-daynight" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
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
    <svg className="deskcal-wx" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
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

export default function HeaderDateTime() {
  const { lang } = useLanguage();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState<{ temperature: number; code: number; is_day: boolean } | null>(null);

  useEffect(() => {
    if (isMobile) return; // no timer on phones — the block isn't shown there
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [isMobile]);

  useEffect(() => {
    if (isMobile) return;
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
  }, [isMobile]);

  if (isMobile) return null;

  const SEOUL = "Asia/Seoul";
  const NY = "America/New_York";

  const dp = parts(now, SEOUL, { year: "numeric", month: "short", day: "numeric", weekday: "short" });
  const monthEn = dp.month.toUpperCase();
  const day = dp.day;
  const year = dp.year;
  const weekdayEn = dp.weekday.toUpperCase();
  const weekdayKo = new Intl.DateTimeFormat("ko-KR", { timeZone: SEOUL, weekday: "long" }).format(now);
  const weekday = lang === "ko" ? weekdayKo : weekdayEn;

  // Korean calendar convention: Sunday numbers in red, Saturday in blue.
  const weekendTone = weekdayEn === "SUN" ? "is-sun" : weekdayEn === "SAT" ? "is-sat" : "";

  const cities = [
    { key: SEOUL, label: lang === "ko" ? "서울" : "SEOUL", flag: "/img/flag/kr.svg" },
    { key: NY, label: lang === "ko" ? "뉴욕" : "NEW YORK", flag: "/img/flag/us.svg" },
  ];

  return (
    <div className="deskcal" aria-hidden="true">
      <div className="deskcal-card">
        <div className="deskcal-binding">
          <span className="deskcal-ring" />
          <span className="deskcal-ring" />
        </div>

        <div className="deskcal-header">
          <span className="deskcal-month">{monthEn}</span>
          <span className="deskcal-year">{year}</span>
        </div>

        <div className="deskcal-body">
          <div className="deskcal-date">
            <span className={`deskcal-day ${weekendTone}`}>{day}</span>
            <span className={`deskcal-weekday ${weekendTone}`}>{weekday}</span>
            {weather && (
              <span className="deskcal-weather" title={`서울 ${weather.temperature}°C`}>
                <WeatherIcon type={wxType(weather.code)} day={weather.is_day} />
                <span className="deskcal-temp">{weather.temperature}°</span>
              </span>
            )}
          </div>

          {/* A 2-column grid (city | time) rather than a row per city, so both cities'
              time cells start at the same x — the two clocks read as an aligned column. */}
          <div className="deskcal-clocks">
            {cities.map((c) => (
              <Fragment key={c.key}>
                <span className="deskcal-city">
                  <img className="deskcal-flag" src={c.flag} alt="" />
                  {c.label}
                </span>
                <span className="deskcal-time">
                  <DayNightIcon day={isDaytime(now, c.key)} />
                  {clock(now, c.key)}
                  <span className="deskcal-tz">{tzAbbr(now, c.key)}</span>
                </span>
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
