import { useEffect, useState } from "react";
import { GlobalTop20Item, api } from "../api/client";
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
import WorldMapPanel from "./WorldMapPanel";

const STATUS_POLL_MS = 3000;

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

function FighterFigure({ item, player }: { item: GlobalTop20Item; player: "p1" | "p2" }) {
  return (
    <div className={`fight-fighter fight-fighter--${player}`}>
      <div className="fight-fighter-arm fight-fighter-arm--back" />
      <div className="fight-fighter-leg fight-fighter-leg--back" />
      <div className="fight-fighter-leg fight-fighter-leg--front" />
      <div className="fight-fighter-torso" />
      <div className="fight-fighter-arm fight-fighter-arm--front" />
      <div className="fight-fighter-head">
        {item.logo_url && <img src={item.logo_url} alt={item.name} />}
      </div>
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
    >
      {slot && <span className={`fight-roster-badge fight-roster-badge--${slot}`}>{slot.toUpperCase()}</span>}
      <div className="fight-roster-logo-wrap">
        {item.logo_url ? <img src={item.logo_url} alt={item.name} /> : <span>{item.name.slice(0, 2)}</span>}
      </div>
      <div className="fight-roster-name">{item.name}</div>
    </button>
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
      <div className="battle-vs-bar-track">
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

  const [statusA, setStatusA] = useState<GlobalTop20Item | null>(null);
  const [statusB, setStatusB] = useState<GlobalTop20Item | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [barsAtZero, setBarsAtZero] = useState(false);

  useEffect(() => {
    api
      .globalTop20()
      .then((res) => setRoster(res.items))
      .catch((err: Error) => setRosterError(err.message || "글로벌 TOP20 데이터를 불러오지 못했습니다."));
  }, []);

  // Both slots filled -> lock in and transition to the fight screen automatically,
  // matching the character-select flow the user asked for (no separate confirm step).
  useEffect(() => {
    if (p1 && p2 && phase === "select") {
      const id = window.setTimeout(() => setPhase("fight"), 350);
      return () => window.clearTimeout(id);
    }
  }, [p1, p2, phase]);

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
    setPhase("select");
  };

  const total = statusA && statusB ? statusA.marcap_usd + statusB.marcap_usd : 0;
  const aPct = total > 0 && statusA ? (statusA.marcap_usd / total) * 100 : 50;
  const bPct = 100 - aPct;

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
        </div>
        <h1 className="app-title">{t("시총파이트")}</h1>
      </header>

      {phase === "select" && (
        <div className="fight-select-wrap">
          <WorldMapPanel roster={roster} p1={p1} p2={p2} />

          {rosterError && <div className="error-state">{t(rosterError)}</div>}
          {!roster.length && !rosterError && <div className="loading-state">{t("데이터를 불러오는 중...")}</div>}

          <div className="fight-select-hint">
            {!p1 && t("1P를 선택하세요")}
            {p1 && !p2 && t("2P를 선택하세요")}
            {p1 && p2 && t("대결 준비 중...")}
          </div>

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
        </div>
      )}

      {phase === "fight" && p1 && p2 && (
        <div className="battle-arena-wrap">
          <div className="fight-arena">
            <FighterFigure item={p1} player="p1" />
            <div className="fight-arena-vs-badge">VS</div>
            <FighterFigure item={p2} player="p2" />

            {statusA && statusB && (
              <div className="battle-vs-overlay fight-vs-overlay">
                <FightVsSide item={statusA} player="p1" pct={aPct} barsAtZero={barsAtZero} lang={lang} />
                <FightVsSide item={statusB} player="p2" pct={bPct} barsAtZero={barsAtZero} lang={lang} />
              </div>
            )}
          </div>

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
