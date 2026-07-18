import { useEffect, useState } from "react";
import { GlobalTop20Item, api } from "../api/client";
import { CEO_NAMES } from "../data/ceoNames";
import { ceoStylizedImageFor } from "../data/ceoStylizedImages";
import { hiResFlagUrl } from "../data/flagCodes";
import { productImageFor } from "../data/productImages";
import { trillionSuffix } from "../i18n/format";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { useTranslatedText } from "../i18n/useTranslatedTexts";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import DashboardIcon from "./DashboardIcon";
import FightCheerSection from "./FightCheerSection";
import Footer from "./Footer";
import LanguageToggle from "./LanguageToggle";
import Logo from "./Logo";
import MarketIcon from "./MarketIcon";
import RollingValue from "./RollingValue";
import SlotMachineValue from "./SlotMachineValue";
import ThemeToggle from "./ThemeToggle";

const STATUS_POLL_MS = 3000;
// Tuned to the info card's actual width/font-size so a 2-3 sentence description
// reliably fits in ~3 lines without the box needing to clip anything.
const INTRO_MAX_CHARS = 130;
const TYPE_MS_PER_CHAR = 16;

// Per-tab cache: a company's intro doesn't change, so re-picking it (or swapping
// 1P/2P) replays the typing instantly-fetched instead of hitting the API again.
const INTRO_CACHE = new Map<string, string>();

function formatMarcap(marcapUsd: number, lang: "ko" | "en"): string {
  // marcap_usd is already USD — reuse the same trillion-suffix formatter the battle
  // page uses for KRW, just applied to a USD figure (still "조 단위" phrasing in Korean).
  return `${(marcapUsd / 1_000_000_000_000).toFixed(2)}${trillionSuffix(lang)}`;
}

function changeClass(changePct: number | null | undefined): string {
  if (!changePct) return "change-flat";
  if (changePct > 0) return "change-up";
  if (changePct < 0) return "change-down";
  return "change-flat";
}

function formatChangePct(changePct: number | null | undefined): string {
  const v = changePct ?? 0;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

/** Trims the scraped company description to roughly three display lines by keeping
 * whole sentences, not by cutting mid-word/mid-sentence and appending "…" — stops
 * adding sentences once the budget would be exceeded, so the result always ends on
 * a real period. If even the first sentence alone runs over budget, it's kept in
 * full rather than chopped, since a slightly-long complete sentence reads better
 * than a truncated one. */
function truncateIntro(text: string): string {
  const clean = text.trim();
  if (!clean) return clean;
  const sentences = clean.split(/(?<=[.!?])\s+/);
  let result = "";
  for (const sentence of sentences) {
    const candidate = result ? `${result} ${sentence}` : sentence;
    if (result && candidate.length > INTRO_MAX_CHARS) break;
    result = candidate;
    if (candidate.length > INTRO_MAX_CHARS) break;
  }
  return result;
}

function useCompanyIntro(item: GlobalTop20Item | null, lang: string): string | null {
  const [intro, setIntro] = useState<string | null>(null);

  useEffect(() => {
    if (!item?.detail_path) {
      setIntro(item ? "" : null);
      return;
    }
    const key = `${item.detail_path}:${lang}`;
    const cached = INTRO_CACHE.get(key);
    if (cached !== undefined) {
      setIntro(cached);
      return;
    }
    let cancelled = false;
    setIntro(null);
    api
      .companyDetail(item.detail_path, lang)
      .then((res) => {
        if (cancelled) return;
        const trimmed = truncateIntro(res.description || "");
        INTRO_CACHE.set(key, trimmed);
        setIntro(trimmed);
      })
      .catch(() => {
        // Intro is decorative — an empty card body beats an error state here.
        if (!cancelled) setIntro("");
      });
    return () => {
      cancelled = true;
    };
  }, [item, item?.detail_path, lang]);

  return item ? intro : null;
}

/** Types `text` out one character at a time with a blinking caret, then reports
 * completion once (including immediately for empty text) so the parent can gate the
 * countdown-to-fight on both sides having finished their intro. */
function Typewriter({ text, onComplete }: { text: string; onComplete?: () => void }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(0);
    if (!text) return;
    const id = window.setInterval(() => {
      setCount((c) => {
        if (c >= text.length) {
          window.clearInterval(id);
          return c;
        }
        return c + 1;
      });
    }, TYPE_MS_PER_CHAR);
    return () => window.clearInterval(id);
  }, [text]);

  const done = count >= text.length;

  useEffect(() => {
    if (done) onComplete?.();
    // onComplete intentionally excluded: it should only fire on the done transition,
    // not on every re-render where the parent passes a new function identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  return (
    <p className="fight-info-intro">
      {text.slice(0, count)}
      <span className={`fight-info-caret${done ? " done" : ""}`} />
    </p>
  );
}

/** companiesmarketcap serves the same logo at /64/, /128/ and /256/ — the roster API
 * hands us the 64px variant, so swap in the 256px one for crisp large tiles, keeping
 * the original as an onError fallback in case a particular logo lacks the big size. */
function CompanyLogo({ item, className }: { item: GlobalTop20Item; className?: string }) {
  const [failedHiRes, setFailedHiRes] = useState(false);
  if (!item.logo_url) return <span className="fight-logo-fallback">{item.name.slice(0, 2)}</span>;
  const src = failedHiRes ? item.logo_url : item.logo_url.replace("/company-logos/64/", "/company-logos/256/");
  return (
    <img
      src={src}
      alt={item.name}
      className={className}
      onError={() => {
        if (!failedHiRes) setFailedHiRes(true);
      }}
    />
  );
}

/** Replaces the old world-map panel: a large edge-to-edge flag banner up top, company
 * name + the CEO's English name under it, then a three-line company intro that types
 * itself out. */
function InfoCard({
  item,
  player,
  intro,
  onIntroDone,
}: {
  item: GlobalTop20Item | null;
  player: "p1" | "p2";
  intro: string | null;
  onIntroDone: () => void;
}) {
  const t = useT();
  const ceo = item ? CEO_NAMES[item.code] : undefined;
  // flagcdn's vector flag renders crisp at any size; companiesmarketcap's own flag
  // icon is only 32x32px and visibly blurs stretched across the full-width banner,
  // so it's kept only as a fallback for a country flagcdn isn't mapped for.
  const flagSrc = item ? hiResFlagUrl(item.country) ?? item.flag_url : null;
  const ceoImgSrc = item ? ceoStylizedImageFor(item.code) : null;
  return (
    <div className={`fight-info-card fight-info-card--${player}${item ? " picked" : ""}`}>
      <div className="fight-info-label">{player === "p1" ? "1P" : "2P"}</div>
      {item ? (
        <>
          {/* Logo - CEO portrait - flag, in that order, on both mobile and desktop. */}
          <div className="fight-info-banner-row">
            <div className="fight-info-logo-cell">
              <CompanyLogo item={item} className="fight-logo-img" />
            </div>
            {ceoImgSrc && (
              <div className="fight-info-ceo-wrap">
                <img src={ceoImgSrc} className="fight-info-ceo-photo" alt={ceo ?? item.name} />
              </div>
            )}
            {flagSrc && (
              <div className="fight-info-flag-wrap">
                <img src={flagSrc} className="fight-info-flag" alt={item.country} />
              </div>
            )}
          </div>
          <div className="fight-info-company">{item.name}</div>
          {ceo && <div className="fight-info-ceo">CEO · {ceo}</div>}
          {intro === null ? (
            <div className="fight-info-loading">{t("데이터를 불러오는 중...")}</div>
          ) : (
            <Typewriter text={intro} onComplete={onIntroDone} />
          )}
        </>
      ) : (
        <div className="fight-info-empty">
          <span>?</span>
          <span className="fight-info-empty-hint">{player === "p1" ? t("1P를 선택하세요") : t("2P를 선택하세요")}</span>
        </div>
      )}
    </div>
  );
}

function SelectPortrait({ item, player }: { item: GlobalTop20Item | null; player: "p1" | "p2" }) {
  return (
    <div className={`fight-select-portrait fight-select-portrait--${player}${item ? " picked" : ""}`}>
      <div className="fight-select-portrait-label">{player === "p1" ? "1P" : "2P"}</div>
      <div className="fight-select-portrait-frame">
        {item ? <CompanyLogo item={item} className="fight-logo-img" /> : <span className="fight-select-portrait-empty">?</span>}
      </div>
      <div className="fight-select-portrait-name">{item ? item.name : "— — —"}</div>
    </div>
  );
}

function RosterCard({
  item,
  slot,
  onClick,
}: {
  item: GlobalTop20Item;
  slot: "p1" | "p2" | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`fight-roster-card${slot ? ` fight-roster-card--${slot}` : ""}`}
      onClick={onClick}
      title={item.name}
    >
      {slot && <span className={`fight-roster-badge fight-roster-badge--${slot}`}>{slot.toUpperCase()}</span>}
      <div className="fight-roster-logo-tile">
        <CompanyLogo item={item} className="fight-logo-img" />
      </div>
      <div className="fight-roster-name">{item.name}</div>
    </button>
  );
}

/** One side of the VS composition: a fixed-size card with the player-color glow —
 * deliberately no animated humanoid figure, just the CEO portrait (illustrated, not
 * a real photo) squaring off, with the company logo as a small badge overlapping its
 * bottom-right corner. Falls back to the plain logo for any company without a
 * stylized portrait. */
function FightCard({ item, player }: { item: GlobalTop20Item; player: "p1" | "p2" }) {
  const ceoImgSrc = ceoStylizedImageFor(item.code);
  return (
    <div className={`fight-fighter fight-fighter--${player}`}>
      <div className="fight-fighter-aura" />
      {/* Separate wrapper (no overflow:hidden) just for the card + its corner badge —
          the badge intentionally overlaps the card's edge, and `.fight-card` itself
          needs overflow:hidden to keep the CEO photo's corners rounded, which was
          clipping the badge's overhanging part before this was split out. */}
      <div className="fight-card-wrap">
        <div className={`fight-card${ceoImgSrc ? " fight-card--photo" : ""}`}>
          {ceoImgSrc ? (
            <img src={ceoImgSrc} alt={CEO_NAMES[item.code] ?? item.name} className="fight-card-ceo-photo" />
          ) : (
            <CompanyLogo item={item} className="fight-logo-img" />
          )}
        </div>
        {ceoImgSrc && (
          <div className="fight-card-logo-badge">
            <CompanyLogo item={item} className="fight-logo-img" />
          </div>
        )}
      </div>
      <div className="fight-fighter-nameplate">
        <span className="fight-fighter-nameplate-company">{item.name}</span>
      </div>
    </div>
  );
}

function FightVsSide({
  item,
  player,
  pct,
  barsAtZero,
  lang,
}: {
  item: GlobalTop20Item;
  player: "p1" | "p2";
  pct: number;
  barsAtZero: boolean;
  lang: "ko" | "en";
}) {
  const name = useTranslatedText(item.name);
  const side = player === "p1" ? "left" : "right";
  return (
    <div className={`battle-vs-side ${side}`}>
      <div className={`battle-vs-label-row fight-${player}-color`}>
        {player === "p1" ? (
          <>
            <span className="battle-vs-name">{name}</span>
            <span className="battle-vs-pct">
              <RollingValue value={pct} text={`${pct.toFixed(1)}%`} />
            </span>
          </>
        ) : (
          <>
            <span className="battle-vs-pct">
              <RollingValue value={pct} text={`${pct.toFixed(1)}%`} />
            </span>
            <span className="battle-vs-name">{name}</span>
          </>
        )}
      </div>
      <div className="battle-vs-bar-track fight-hp-track">
        <div
          className={`battle-vs-bar-fill fight-${player}-fill ${side} ${barsAtZero ? "reset" : ""}`}
          style={{ width: `${barsAtZero ? 0 : pct}%` }}
        />
      </div>
      <div className="battle-vs-marcap">
        <SlotMachineValue value={item.marcap_usd} text={formatMarcap(item.marcap_usd, lang)} />
      </div>
      <div className={`battle-vs-price ${changeClass(item.change_pct)}`}>
        <RollingValue value={item.change_pct ?? 0} text={formatChangePct(item.change_pct)} />
      </div>
    </div>
  );
}

export default function MarketCapFightPage() {
  const { lang } = useLanguage();
  const t = useT();
  useDocumentTitle("시총파이트 | K-Stock Hub");

  const [roster, setRoster] = useState<GlobalTop20Item[]>([]);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [p1, setP1] = useState<GlobalTop20Item | null>(null);
  const [p2, setP2] = useState<GlobalTop20Item | null>(null);
  const [phase, setPhase] = useState<"select" | "fight">("select");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [p1IntroDone, setP1IntroDone] = useState(false);
  const [p2IntroDone, setP2IntroDone] = useState(false);

  const [statusA, setStatusA] = useState<GlobalTop20Item | null>(null);
  const [statusB, setStatusB] = useState<GlobalTop20Item | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [barsAtZero, setBarsAtZero] = useState(false);

  const p1Intro = useCompanyIntro(p1, lang);
  const p2Intro = useCompanyIntro(p2, lang);

  useEffect(() => {
    api
      .globalTop20()
      .then((res) => setRoster(res.items))
      .catch((err: Error) => setRosterError(err.message || "글로벌 TOP20 데이터를 불러오지 못했습니다."));
  }, []);

  // A fresh pick on either side invalidates that side's "finished typing" flag, so
  // the countdown below can't fire off a stale completion from the previous pick.
  useEffect(() => setP1IntroDone(false), [p1?.code]);
  useEffect(() => setP2IntroDone(false), [p2?.code]);

  // On mobile the roster grid sits below the fold, so picking 2P (completing the
  // pair) would otherwise leave the info cards / countdown off-screen — scroll back
  // to the top so the player actually sees them. Desktop already shows everything
  // at once, so this is scoped to narrow viewports only.
  useEffect(() => {
    if (p1 && p2 && phase === "select" && window.matchMedia("(max-width: 640px)").matches) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [p1, p2, phase]);

  // Both intros fully typed out -> run a 3/2/1 countdown, then transition to the
  // fight screen (the countdown's 3 seconds IS the "3 seconds after exposure finishes"
  // beat the user asked for, not an extra wait on top of it).
  useEffect(() => {
    if (phase !== "select" || !p1 || !p2 || !p1IntroDone || !p2IntroDone) return;
    let n = 3;
    setCountdown(n);
    const id = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        window.clearInterval(id);
        setCountdown(null);
        setPhase("fight");
        return;
      }
      setCountdown(n);
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase, p1, p2, p1IntroDone, p2IntroDone]);

  useEffect(() => {
    if (phase !== "fight" || !p1 || !p2) return;
    let cancelled = false;

    const poll = () => {
      api
        .fightStatus(p1.code, p2.code)
        .then((res) => {
          if (cancelled) return;
          setStatusA(res.a);
          setStatusB(res.b);
          setStatusError(null);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          setStatusError(err.message || "시가총액 데이터를 불러오지 못했습니다.");
        });
    };

    poll();
    const stopPolling = startVisibilityAwareInterval(poll, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [phase, p1, p2]);

  useEffect(() => {
    if (phase !== "fight") return;
    const id = window.setInterval(() => {
      setBarsAtZero(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setBarsAtZero(false));
      });
    }, 9000);
    return () => window.clearInterval(id);
  }, [phase]);

  const handleRosterClick = (item: GlobalTop20Item) => {
    if (p1?.code === item.code) {
      setP1(null);
      return;
    }
    if (p2?.code === item.code) {
      setP2(null);
      return;
    }
    if (!p1) {
      setP1(item);
      return;
    }
    if (!p2) {
      setP2(item);
    }
  };

  const resetSelection = () => {
    setP1(null);
    setP2(null);
    setStatusA(null);
    setStatusB(null);
    setCountdown(null);
    setPhase("select");
  };

  const total = statusA && statusB ? statusA.marcap_usd + statusB.marcap_usd : 0;
  const aPct = total > 0 && statusA ? (statusA.marcap_usd / total) * 100 : 50;
  const bPct = 100 - aPct;

  // Same leader/gap readout the fixed battle page shows (2위 · 차이), adapted to USD.
  const aWinning = aPct >= bPct;
  const leader = statusA && statusB ? (aWinning ? statusA : statusB) : null;
  const trailing = statusA && statusB ? (aWinning ? statusB : statusA) : null;
  const diffMarcap = statusA && statusB ? Math.abs(statusA.marcap_usd - statusB.marcap_usd) / 1_000_000_000_000 : 0;
  const diffPct = Math.abs(aPct - bPct);
  const leaderName = useTranslatedText(leader?.name ?? "");
  const trailingName = useTranslatedText(trailing?.name ?? "");

  return (
    <div className="app fight-page">
      <header className="app-header">
        <div className="app-title-row">
          <Link to="/" className="app-brand" aria-label="K-Stock Hub">
            <Logo className="app-logo-wide" />
          </Link>
          <div className="app-header-meta">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
        <div className="app-nav-row">
          <Link to="/" className="kospi-map-nav-link kospi-map-nav-link--home">
            <DashboardIcon /> {t("홈")}
          </Link>
          <Link to="/battle" className="kospi-map-nav-link">
            <MarketIcon /> {t("시총대결")}
          </Link>
          {phase === "fight" && (
            <button type="button" className="fight-back-link" onClick={resetSelection}>
              ◀ PLAYER SELECT
            </button>
          )}
        </div>
        <h1 className="app-title">{t("시총파이트")}</h1>
      </header>

      {phase === "select" && (
        <div className="fight-select-wrap">
          <div className="fight-arcade-header">
            <span>PLAYER SELECT</span>
          </div>

          <div className="fight-info-stage">
            <InfoCard item={p1} player="p1" intro={p1Intro} onIntroDone={() => setP1IntroDone(true)} />
            <InfoCard item={p2} player="p2" intro={p2Intro} onIntroDone={() => setP2IntroDone(true)} />
          </div>

          {countdown !== null && (
            <div className="fight-countdown-overlay">
              <div key={countdown} className="fight-countdown-number">
                {countdown}
              </div>
            </div>
          )}

          {rosterError && <div className="error-state">{t(rosterError)}</div>}
          {!roster.length && !rosterError && <div className="loading-state">{t("데이터를 불러오는 중...")}</div>}

          {roster.length > 0 && (
            <div className="fight-select-stage">
              <SelectPortrait item={p1} player="p1" />
              <div className="fight-roster-grid">
                {roster.map((item) => (
                  <RosterCard
                    key={item.code}
                    item={item}
                    slot={p1?.code === item.code ? "p1" : p2?.code === item.code ? "p2" : null}
                    onClick={() => handleRosterClick(item)}
                  />
                ))}
              </div>
              <SelectPortrait item={p2} player="p2" />
            </div>
          )}

          <div className="fight-select-hint">
            {!p1 && t("1P를 선택하세요")}
            {p1 && !p2 && t("2P를 선택하세요")}
            {p1 && p2 && t("대결 준비 중...")}
          </div>
        </div>
      )}

      {phase === "fight" && p1 && p2 && (
        <div className="battle-arena-wrap">
          <div className="fight-arena">
            <div
              className="fight-arena-bg fight-arena-bg--p1"
              style={p1 && productImageFor(p1.code) ? { backgroundImage: `url(${productImageFor(p1.code)})` } : undefined}
            />
            <div
              className="fight-arena-bg fight-arena-bg--p2"
              style={p2 && productImageFor(p2.code) ? { backgroundImage: `url(${productImageFor(p2.code)})` } : undefined}
            />
            <div className="fight-arena-vignette" />
            <div className="fight-arena-spotlight" />
            <div className="fight-arena-floor" />
            <div className="fight-arena-flash" />
            <div className="fight-arena-fight-text">FIGHT!</div>

            <FightCard item={statusA ?? p1} player="p1" />

            <div className="fight-arena-center">
              <div className="fight-lightning fight-lightning--a" />
              <div className="fight-lightning fight-lightning--b" />
              <div className="fight-arena-vs-badge">VS</div>
              <span className="fight-spark fight-spark--1" />
              <span className="fight-spark fight-spark--2" />
              <span className="fight-spark fight-spark--3" />
            </div>

            <FightCard item={statusB ?? p2} player="p2" />

            {statusA && statusB && (
              <div className="battle-vs-overlay fight-vs-overlay">
                <FightVsSide item={statusA} player="p1" pct={aPct} barsAtZero={barsAtZero} lang={lang} />
                <FightVsSide item={statusB} player="p2" pct={bPct} barsAtZero={barsAtZero} lang={lang} />
              </div>
            )}
          </div>

          {leader && trailing && (
            <div className="fight-diff-panel">
              <div className="fight-diff-panel-label">💥 {t("시총 격차")}</div>
              <div className="fight-diff-panel-value">
                <RollingValue value={diffMarcap} text={`$${diffMarcap.toFixed(2)}${trillionSuffix(lang)}`} />
              </div>
              <div className="fight-diff-panel-sub">
                <div className="fight-diff-panel-sub-line">
                  👑 <span className={leader === statusA ? "fight-p1-color" : "fight-p2-color"}>{leaderName}</span>
                </div>
                <div className="fight-diff-panel-sub-line">
                  {t("2위")} {trailingName} (<RollingValue value={diffPct} text={`${diffPct.toFixed(1)}%`} /> {t("차이")})
                </div>
              </div>
            </div>
          )}

          {statusError && <div className="error-state">{t(statusError)}</div>}
          {!statusA && !statusB && !statusError && <div className="loading-state">{t("데이터를 불러오는 중...")}</div>}

          <button type="button" className="fight-reset-btn" onClick={resetSelection}>
            {t("다시 선택")}
          </button>

          {statusA && statusB && (
            <FightCheerSection
              key={`${p1.code}-${p2.code}`}
              sideA={{ code: p1.code, name: statusA.name, player: "p1" }}
              sideB={{ code: p2.code, name: statusB.name, player: "p2" }}
            />
          )}
        </div>
      )}

      <Footer />
    </div>
  );
}
