import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link } from "../router";
import { toggleThemeMode, useThemeMode } from "../theme";
import { reportVoltarisIngress } from "../useActivityTracking";
import { useMarketIndices } from "../useMarketIndices";
import { useVisitorCount } from "../useVisitorCount";
import Logo from "../components/Logo";
import { NEW_YORK, SEOUL, clockText, useL, useNow, zoneParts } from "./lib";

/* The masthead.
 *
 * A newspaper's first ten centimetres say three things before any story does:
 * what this is, which edition, and when. The desk's version keeps all three and
 * makes the third one live — the dateline is today's date, Seoul's sky and both
 * wall clocks, and under it a 24-hour rail on Seoul time shows where each
 * market's session sits and where "now" is against them. That rail replaces the
 * classic desk's split-flap cabinet: the same readings, but answering the
 * question a reader actually has at a glance — is anything trading, and when is
 * the next bell. */

type Weather = { temperature: number; code: number; is_day: boolean };

function skyText(code: number, lang: "ko" | "en"): string {
  const ko = lang === "ko";
  if (code === 0) return ko ? "맑음" : "Clear";
  if (code <= 2) return ko ? "구름 조금" : "Partly cloudy";
  if (code === 3) return ko ? "흐림" : "Overcast";
  if (code === 45 || code === 48) return ko ? "안개" : "Fog";
  if (code >= 51 && code <= 57) return ko ? "이슬비" : "Drizzle";
  if (code >= 61 && code <= 67) return ko ? "비" : "Rain";
  if (code >= 71 && code <= 77) return ko ? "눈" : "Snow";
  if (code >= 80 && code <= 82) return ko ? "소나기" : "Showers";
  if (code >= 85 && code <= 86) return ko ? "눈보라" : "Snow showers";
  if (code >= 95) return ko ? "뇌우" : "Thunderstorm";
  return ko ? "날씨" : "Weather";
}

/* Session windows, minutes from midnight in each market's own zone. */
const KR_WINDOWS = [
  { from: 8 * 60, to: 8 * 60 + 50, kind: "ext" as const, ko: "NXT 프리", en: "NXT pre" },
  { from: 9 * 60, to: 15 * 60 + 30, kind: "reg" as const, ko: "정규장", en: "Regular" },
  { from: 15 * 60 + 30, to: 20 * 60, kind: "ext" as const, ko: "NXT 애프터", en: "NXT after" },
];
const US_WINDOWS = [
  { from: 4 * 60, to: 9 * 60 + 30, kind: "ext" as const, ko: "프리마켓", en: "Pre-market" },
  { from: 9 * 60 + 30, to: 16 * 60, kind: "reg" as const, ko: "정규장", en: "Regular" },
  { from: 16 * 60, to: 20 * 60, kind: "ext" as const, ko: "애프터마켓", en: "After-hours" },
];

type Phase = { label: string; live: boolean; regular: boolean };

function phaseOf(minutes: number, weekday: number, windows: typeof KR_WINDOWS, lang: "ko" | "en"): Phase {
  const weekdayOk = weekday >= 1 && weekday <= 5;
  if (weekdayOk) {
    for (const w of windows) {
      if (minutes >= w.from && minutes < w.to) return { label: lang === "ko" ? w.ko : w.en, live: true, regular: w.kind === "reg" };
    }
  }
  return { label: lang === "ko" ? "휴장" : "Closed", live: false, regular: false };
}

/** Seconds until the regular session in `tz` next opens (or closes, if open). */
function nextBell(now: Date, tz: string, open: number, close: number): { seconds: number; event: "open" | "close" } {
  const p = zoneParts(now, tz);
  const nowSec = p.min * 60 + p.sec;
  const weekdayOk = p.wd >= 1 && p.wd <= 5;
  if (weekdayOk && p.min >= open && p.min < close) return { seconds: close * 60 - nowSec, event: "close" };
  // Walk forward to the next weekday opening. Holidays are not modelled — the
  // rail says so by calling it the scheduled bell, not a promise.
  for (let ahead = 0; ahead < 8; ahead += 1) {
    const wd = (p.wd + ahead) % 7;
    if (wd === 0 || wd === 6) continue;
    const target = ahead * 86400 + open * 60;
    if (target > nowSec) return { seconds: target - nowSec, event: "open" };
  }
  return { seconds: 0, event: "open" };
}

function hms(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** Splits a window that crosses midnight on the Seoul axis into two segments. */
function onSeoulAxis(from: number, to: number, offset: number): Array<[number, number]> {
  const a = (from + offset + 1440) % 1440;
  const b = (to + offset + 1440) % 1440;
  if (a < b) return [[a, b]];
  return [
    [a, 1440],
    [0, b],
  ];
}

function SessionRail({ now, krStatus }: { now: Date; krStatus: string | null }) {
  const { lang } = useLanguage();
  const L = useL();
  const seoul = zoneParts(now, SEOUL);
  const ny = zoneParts(now, NEW_YORK);
  const offset = (seoul.min - ny.min + 1440) % 1440;

  const krPhase = phaseOf(seoul.min, seoul.wd, KR_WINDOWS, lang);
  // The exchange's own status wins over the clock on the regular session:
  // it knows about holidays and the clock does not.
  if (krStatus === "CLOSE" && krPhase.regular) {
    krPhase.label = L("휴장", "Closed");
    krPhase.live = false;
    krPhase.regular = false;
  }
  const usPhase = phaseOf(ny.min, ny.wd, US_WINDOWS, lang);

  const krBell = nextBell(now, SEOUL, 9 * 60, 15 * 60 + 30);
  const usBell = nextBell(now, NEW_YORK, 9 * 60 + 30, 16 * 60);
  const focus =
    krPhase.regular ? { who: "kr", ...krBell } : usPhase.regular ? { who: "us", ...usBell } : krBell.seconds <= usBell.seconds ? { who: "kr", ...krBell } : { who: "us", ...usBell };
  const focusName = focus.who === "kr" ? L("서울", "Seoul") : L("뉴욕", "New York");
  const focusVerb = focus.event === "close" ? L("마감까지", "closes in") : L("개장까지", "opens in");

  const lanes = [
    { key: "kr", name: L("한국", "KRX"), windows: KR_WINDOWS.flatMap((w) => onSeoulAxis(w.from, w.to, 0).map((seg) => ({ seg, w }))), phase: krPhase },
    { key: "us", name: L("미국", "US"), windows: US_WINDOWS.flatMap((w) => onSeoulAxis(w.from, w.to, offset).map((seg) => ({ seg, w }))), phase: usPhase },
  ];
  const nowPos = ((seoul.min + seoul.sec / 60) / 1440) * 100;

  return (
    <div className="d2-rail" role="group" aria-label={L("거래 시간표", "Trading hours")}>
      <div className="d2-rail-lanes">
        {lanes.map((lane) => (
          <div key={lane.key} className={`d2-rail-lane is-${lane.key}`}>
            <span className="d2-rail-name">
              {lane.name}
              <em className={lane.phase.live ? "is-live" : ""}>{lane.phase.label}</em>
            </span>
            <span className="d2-rail-track">
              {lane.windows.map(({ seg, w }, i) => (
                <i
                  key={i}
                  className={`is-${w.kind}`}
                  style={{ left: `${(seg[0] / 1440) * 100}%`, width: `${((seg[1] - seg[0]) / 1440) * 100}%` }}
                  title={`${lang === "ko" ? w.ko : w.en}`}
                />
              ))}
            </span>
          </div>
        ))}
        <span className="d2-rail-now" style={{ left: `calc(var(--rail-label) + (100% - var(--rail-label)) * ${nowPos / 100})` }} aria-hidden="true" />
        <div className="d2-rail-hours" aria-hidden="true">
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
            <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
              {String(h).padStart(2, "0")}
            </span>
          ))}
        </div>
      </div>
      <div className="d2-rail-bell">
        <span>
          {focusName} {focusVerb}
        </span>
        <b>{hms(focus.seconds)}</b>
      </div>
    </div>
  );
}

const SITE_NAV: { to: string; ko: string; en: string; tag?: string }[] = [
  { to: "/stocks", ko: "종목정보", en: "Stocks" },
  { to: "/stock/005930", ko: "종목상세", en: "Stock detail" },
  { to: "/map", ko: "코스피 지도", en: "KOSPI map" },
  { to: "/kosdaq-map", ko: "코스닥 지도", en: "KOSDAQ map" },
  { to: "/sp500-map", ko: "S&P500 지도", en: "S&P 500 map" },
  { to: "/nasdaq100-map", ko: "나스닥 지도", en: "NASDAQ map" },
  { to: "/etf", ko: "ETF", en: "ETF" },
  { to: "/market-brief", ko: "오늘 브리핑", en: "Daily brief" },
  { to: "/discussion-explorer?code=005930&name=삼성전자&market=KR&asset=STOCK", ko: "종목토론", en: "Discussions" },
  { to: "/market-bubbles", ko: "증시버블", en: "Bubbles" },
  { to: "/kospi-100", ko: "TOP100", en: "TOP 100" },
  { to: "/ai-prediction", ko: "AI예측", en: "AI forecast" },
  { to: "/global-top100", ko: "글로벌시총", en: "Global caps" },
  { to: "/fight", ko: "시총대결", en: "Cap fight" },
  { to: "/news", ko: "뉴스", en: "News" },
];

export default function Masthead({ onPrint }: { onPrint: () => void }) {
  const { lang, setLang } = useLanguage();
  const L = useL();
  const now = useNow(1000);
  const mode = useThemeMode();
  const { kospi, kosdaq } = useMarketIndices();
  const visitors = useVisitorCount(true);
  const [weather, setWeather] = useState<Weather | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .seoulWeather()
        .then((w) => alive && setWeather(w))
        .catch(() => {});
    load();
    const stop = startVisibilityAwareInterval(load, 15 * 60_000);
    return () => {
      alive = false;
      stop();
    };
  }, []);

  const seoul = zoneParts(now, SEOUL);
  const dateText = new Intl.DateTimeFormat(lang === "ko" ? "ko-KR" : "en-US", {
    timeZone: SEOUL,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(now);
  const startOfYear = Date.UTC(seoul.y, 0, 1);
  const dayOfYear = Math.floor((Date.UTC(seoul.y, seoul.m - 1, seoul.d) - startOfYear) / 86400000) + 1;
  const krStatus = kospi?.market_status ?? kosdaq?.market_status ?? null;

  return (
    <header className="d2-mast">
      <div className="d2-mast-dateline">
        <span className="d2-mast-date">{dateText}</span>
        {weather && (
          <span className="d2-mast-sky">
            {L("서울", "Seoul")} {skyText(weather.code, lang)} <b>{Math.round(weather.temperature)}°</b>
          </span>
        )}
        <span className="d2-mast-issue" title={L(`올해 ${dayOfYear}번째 지면`, `Day ${dayOfYear} of the year`)}>
          No.{dayOfYear}
        </span>
        <span className="d2-mast-spacer" />
        {visitors.current !== null && (
          <span className="d2-mast-readers" title={L("최근 1분 안에 접속한 브라우저 수", "Browsers active in the last minute")}>
            <i aria-hidden="true" />
            {L("지금 읽는 사람", "Reading now")} <b>{visitors.current.toLocaleString()}</b>
            {visitors.total !== null && (
              <small>
                {L("누적", "total")} {visitors.total.toLocaleString()}
              </small>
            )}
          </span>
        )}
        <button type="button" className="d2-mast-tool" onClick={onPrint} title={L("오늘 지면을 인쇄하거나 PDF로 저장", "Print today's page or save as PDF")}>
          {L("지면 인쇄", "Print")}
        </button>
        <span className="d2-mast-lang" role="group" aria-label="Language">
          <button type="button" className={lang === "ko" ? "is-on" : ""} onClick={() => setLang("ko")}>
            한
          </button>
          <button type="button" className={lang === "en" ? "is-on" : ""} onClick={() => setLang("en")}>
            EN
          </button>
        </span>
        <button
          type="button"
          className="d2-mast-edition"
          onClick={toggleThemeMode}
          aria-label={mode === "dark" ? L("주간판(라이트)으로 전환", "Switch to day edition") : L("야간판(다크)으로 전환", "Switch to night edition")}
        >
          <span className={mode === "light" ? "is-on" : ""}>{L("주간판", "Day")}</span>
          <span className={mode === "dark" ? "is-on" : ""}>{L("야간판", "Night")}</span>
        </button>
      </div>

      <div className="d2-mast-title">
        <Link to="/hub" className="d2-mast-brand" aria-label="K-Stock Hub">
          <Logo className="d2-mast-logo" />
        </Link>
        <div className="d2-mast-name">
          {/* The English edition gets a blackletter nameplate, the way English-
              language papers have always set theirs; the Korean one is set in
              the display serif, as a 제호 would be. */}
          <h1 className={lang === "en" ? "is-blackletter" : ""}>
            {L("마켓", "The Market")}
            <span>{L("데스크", "Desk")}</span>
          </h1>
          <p>{L("숫자로 조판하는 오늘의 시장 — 실시간 개정판", "Today's market, typeset from the numbers — live edition")}</p>
        </div>
        <div className="d2-mast-clocks" data-ear={L("현지 시각", "LOCAL TIME")}>
          <span className="d2-mast-clock">
            <small>{L("서울", "SEOUL")}</small>
            <b>{clockText(now, SEOUL)}</b>
          </span>
          <span className="d2-mast-clock">
            <small>{L("뉴욕", "NEW YORK")}</small>
            <b>{clockText(now, NEW_YORK)}</b>
          </span>
        </div>
      </div>

      <SessionRail now={now} krStatus={krStatus} />

      <nav className="d2-mast-nav" aria-label={L("사이트 메뉴", "Site sections")}>
        <ul>
          {SITE_NAV.map((item) => (
            <li key={item.to}>
              <Link to={item.to}>{lang === "ko" ? item.ko : item.en}</Link>
            </li>
          ))}
          <li>
            <a href="https://voltaris-nyyo.onrender.com/" target="_blank" rel="noopener noreferrer" onClick={() => reportVoltarisIngress("/desk")} className="is-ext">
              VOLTARIS ↗
            </a>
          </li>
        </ul>
      </nav>
    </header>
  );
}
