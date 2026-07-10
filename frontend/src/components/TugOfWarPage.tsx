import { useEffect, useRef, useState } from "react";
import { BattleSide, ExchangeRate, api } from "../api/client";
import { trillionSuffix, wonSuffix } from "../i18n/format";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { useTranslatedText } from "../i18n/useTranslatedTexts";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import CheerSection from "./CheerSection";
import Footer from "./Footer";
import GlobalTop20 from "./GlobalTop20";
import LanguageToggle from "./LanguageToggle";
import Logo from "./Logo";
import RollingValue from "./RollingValue";
import SlotMachineValue from "./SlotMachineValue";
import ThemeToggle from "./ThemeToggle";
import VisitorBadge from "./VisitorBadge";

const POLL_MS = 3000;
const REFILL_MS = 9000;
const FX_POLL_MS = 3000;
const FX_POP_MS = 2500;

const ENGLISH_NAME: Record<string, string> = {
  "005930": "SAMSUNG ELECTRONICS",
  "000660": "SK HYNIX",
};

function formatMarcap(marcap: number, lang: "ko" | "en"): string {
  return `${(marcap / 1_000_000_000_000).toFixed(1)}${trillionSuffix(lang)}`;
}

function changeClass(changePct: number): string {
  if (changePct > 0) return "change-up";
  if (changePct < 0) return "change-down";
  return "change-flat";
}

function formatChangePct(changePct: number): string {
  return `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;
}

export default function TugOfWarPage() {
  const { lang } = useLanguage();
  const t = useT();
  useDocumentTitle("K-Stock Hub");

  const [samsung, setSamsung] = useState<BattleSide | null>(null);
  const [skhynix, setSkhynix] = useState<BattleSide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [barsAtZero, setBarsAtZero] = useState(false);

  const [fx, setFx] = useState<ExchangeRate | null>(null);
  const [fxDirection, setFxDirection] = useState<"up" | "down" | null>(null);
  const [fxPop, setFxPop] = useState<"up" | "down" | null>(null);
  const [fxPopNonce, setFxPopNonce] = useState(0);
  const prevFxRateRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = () => {
      api
        .battle()
        .then((res) => {
          if (cancelled) return;
          setSamsung(res.samsung);
          setSkhynix(res.skhynix);
          setError(null);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          setError(err.message || "시가총액 데이터를 불러오지 못했습니다.");
        });
    };

    poll();
    const stopPolling = startVisibilityAwareInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, []);

  // Every 3rd data refresh (9s), replay the gauge fill from 0 up to the current
  // ratio instead of just holding steady, so the "battle" feels continuously live.
  useEffect(() => {
    const id = window.setInterval(() => {
      setBarsAtZero(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setBarsAtZero(false));
      });
    }, REFILL_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const poll = () => {
      api
        .exchangeRate()
        .then((res) => {
          if (cancelled) return;
          const prev = prevFxRateRef.current;
          if (prev !== null && res.rate !== prev) {
            const dir = res.rate > prev ? "up" : "down";
            setFxDirection(dir);
            setFxPop(dir);
            setFxPopNonce((n) => n + 1);
            window.setTimeout(() => setFxPop(null), FX_POP_MS);
          }
          prevFxRateRef.current = res.rate;
          setFx(res);
        })
        .catch(() => {
          // Exchange rate is a nice-to-have overlay — leave it hidden on failure
          // rather than surfacing another error state on top of the battle one.
        });
    };

    poll();
    const stopPolling = startVisibilityAwareInterval(poll, FX_POLL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, []);

  const total = samsung && skhynix ? samsung.marcap + skhynix.marcap : 0;
  const samsungPct = total > 0 && samsung ? (samsung.marcap / total) * 100 : 50;
  const skhynixPct = 100 - samsungPct;
  const samsungWinning = samsungPct >= skhynixPct;

  const leader = samsung && skhynix ? (samsungWinning ? samsung : skhynix) : null;
  const trailing = samsung && skhynix ? (samsungWinning ? skhynix : samsung) : null;
  const diffMarcap = samsung && skhynix ? Math.abs(samsung.marcap - skhynix.marcap) / 1_000_000_000_000 : 0;
  const diffPct = Math.abs(samsungPct - skhynixPct);

  const samsungName = useTranslatedText(samsung?.name ?? "");
  const skhynixName = useTranslatedText(skhynix?.name ?? "");
  const trailingName = useTranslatedText(trailing?.name ?? "");

  return (
    <div className="app battle-page">
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
          <Link to="/map" className="kospi-map-nav-link">
            🗺 KOSPI
          </Link>
          <Link to="/kosdaq-map" className="kospi-map-nav-link">
            🟢 KOSDAQ
          </Link>
          <VisitorBadge />
        </div>
        <h1 className="app-title">{t("시총 줄다리기 (삼성전자 VS SK하이닉스)")}</h1>
      </header>

      {error && <div className="error-state">{t(error)}</div>}

      {!samsung && !skhynix && !error && <div className="loading-state">{t("데이터를 불러오는 중...")}</div>}

      {samsung && skhynix && leader && trailing && (
        <div className="battle-arena-wrap">
          <div className="battle-video-wrap">
            <video className="battle-video" src="/video/zzanggu.mp4" autoPlay loop muted playsInline />

            <div className="battle-vs-overlay">
              <div className="battle-vs-side left">
                <div className="battle-vs-label-row samsung-color">
                  <span className="battle-vs-name">{samsungName}</span>
                  <span className="battle-vs-pct">
                    <RollingValue value={samsungPct} text={`${samsungPct.toFixed(1)}%`} />
                  </span>
                </div>
                <div className="battle-vs-bar-track">
                  <div
                    className={`battle-vs-bar-fill left ${barsAtZero ? "reset" : ""}`}
                    style={{ width: `${barsAtZero ? 0 : samsungPct}%` }}
                  />
                </div>
                <div className="battle-vs-marcap">
                  <SlotMachineValue value={samsung.marcap} text={formatMarcap(samsung.marcap, lang)} />
                </div>
                <div className={`battle-vs-price ${changeClass(samsung.change_pct)}`}>
                  <RollingValue value={samsung.close} text={`${samsung.close.toLocaleString()}${wonSuffix(lang)}`} />{" "}
                  <RollingValue value={samsung.change_pct} text={formatChangePct(samsung.change_pct)} />
                </div>
              </div>

              <div className="battle-vs-side right">
                <div className="battle-vs-label-row skhynix-color">
                  <span className="battle-vs-pct">
                    <RollingValue value={skhynixPct} text={`${skhynixPct.toFixed(1)}%`} />
                  </span>
                  <span className="battle-vs-name">{skhynixName}</span>
                </div>
                <div className="battle-vs-bar-track">
                  <div
                    className={`battle-vs-bar-fill right ${barsAtZero ? "reset" : ""}`}
                    style={{ width: `${barsAtZero ? 0 : skhynixPct}%` }}
                  />
                </div>
                <div className="battle-vs-marcap">
                  <SlotMachineValue value={skhynix.marcap} text={formatMarcap(skhynix.marcap, lang)} />
                </div>
                <div className={`battle-vs-price ${changeClass(skhynix.change_pct)}`}>
                  <RollingValue value={skhynix.close} text={`${skhynix.close.toLocaleString()}${wonSuffix(lang)}`} />{" "}
                  <RollingValue value={skhynix.change_pct} text={formatChangePct(skhynix.change_pct)} />
                </div>
              </div>
            </div>

            <div className={`battle-rank1-name ${leader.code === "005930" ? "leader-samsung" : "leader-skhynix"}`}>
              {ENGLISH_NAME[leader.code] ?? leader.name}
            </div>
            <div className="battle-rank2-info">
              {t("2위")} {trailingName} ·{" "}
              <RollingValue
                className="battle-rank2-diff"
                value={diffMarcap}
                text={`${diffMarcap.toFixed(1)}${trillionSuffix(lang)}`}
              />{" "}
              {t("차이")} (<RollingValue value={diffPct} text={`${diffPct.toFixed(1)}%`} />)
            </div>

            {fx && (
              <>
                {fxPop && (
                  <>
                    <div key={`label-${fxPopNonce}`} className={`battle-fx-pop-label ${fxPop}`}>
                      {fxPop === "up" ? t("환율 UP 👍") : t("환율 DOWN 👎")}
                    </div>
                    <img key={`img-${fxPopNonce}`} src={`/img/${fxPop}.jpg`} className={`battle-fx-pop ${fxPop}`} alt="" />
                  </>
                )}
                <div
                  className={`battle-fx-rate ${
                    fxDirection === "up" ? "change-up" : fxDirection === "down" ? "change-down" : ""
                  }`}
                >
                  {t("환율(원)")}{" "}
                  <RollingValue className="battle-fx-rate-amount" value={fx.rate} text={fx.rate.toFixed(2)} />
                </div>
              </>
            )}
          </div>

          <CheerSection />
        </div>
      )}

      {/* Mounted only once the battle data above has loaded, so the top of the page
          always finishes painting before this section starts its own fetch — otherwise
          this list (a single fast request) could pop in before the arena above it. */}
      {samsung && skhynix && <GlobalTop20 />}

      <Footer />
    </div>
  );
}
