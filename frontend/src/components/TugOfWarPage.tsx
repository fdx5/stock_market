import { useEffect, useState } from "react";
import { BattleSide, api } from "../api/client";
import { Link } from "../router";
import VisitorBadge from "./VisitorBadge";

const POLL_MS = 3000;

function formatMarcap(marcap: number): string {
  return `${(marcap / 1_000_000_000_000).toFixed(1)}조`;
}

function changeClass(changePct: number): string {
  if (changePct > 0) return "change-up";
  if (changePct < 0) return "change-down";
  return "change-flat";
}

export default function TugOfWarPage() {
  const [samsung, setSamsung] = useState<BattleSide | null>(null);
  const [skhynix, setSkhynix] = useState<BattleSide | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const total = samsung && skhynix ? samsung.marcap + skhynix.marcap : 0;
  const samsungPct = total > 0 && samsung ? (samsung.marcap / total) * 100 : 50;
  const skhynixPct = 100 - samsungPct;
  // The knot's position tracks the opponent's share: the heavier side drags it
  // toward its own end. Clamped so both characters stay on screen at the extremes.
  const knotLeft = Math.min(80, Math.max(20, skhynixPct));
  const samsungWinning = samsungPct >= skhynixPct;
  const ropeFlowClass = samsungWinning ? "flow-left" : "flow-right";

  return (
    <div className="app battle-page">
      <header className="app-header">
        <Link to="/" className="back-link">
          ← 메인으로
        </Link>
        <div className="app-title-row">
          <h1 className="app-title">시총 줄다리기</h1>
          <VisitorBadge />
        </div>
        <p className="app-subtitle">삼성전자 vs SK하이닉스, 실시간 시가총액 비율로 겨루는 줄다리기 (3초마다 갱신)</p>
      </header>

      {error && <div className="error-state">{error}</div>}

      {!samsung && !skhynix && !error && <div className="loading-state">데이터를 불러오는 중...</div>}

      {samsung && skhynix && (
        <div className="battle-arena-wrap">
          <div className="battle-scoreboard">
            <div className={`battle-score battle-score-left ${samsungWinning ? "winning" : ""}`}>
              <div className="battle-score-name">{samsung.name}</div>
              <div className="battle-score-marcap">{formatMarcap(samsung.marcap)}</div>
              <div className={`battle-score-price ${changeClass(samsung.change_pct)}`}>
                {samsung.close.toLocaleString()}원 ({samsung.change_pct >= 0 ? "+" : ""}
                {samsung.change_pct}%)
              </div>
              <div className="battle-score-pct">시총 비중 {samsungPct.toFixed(1)}%</div>
            </div>

            <div className="battle-score-vs">VS</div>

            <div className={`battle-score battle-score-right ${!samsungWinning ? "winning" : ""}`}>
              <div className="battle-score-name">{skhynix.name}</div>
              <div className="battle-score-marcap">{formatMarcap(skhynix.marcap)}</div>
              <div className={`battle-score-price ${changeClass(skhynix.change_pct)}`}>
                {skhynix.close.toLocaleString()}원 ({skhynix.change_pct >= 0 ? "+" : ""}
                {skhynix.change_pct}%)
              </div>
              <div className="battle-score-pct">시총 비중 {skhynixPct.toFixed(1)}%</div>
            </div>
          </div>

          <div className="battle-field">
            <div className={`battle-character battle-character-left ${samsungWinning ? "pulling" : "losing"}`}>
              <img src="/img/zzanggu_samsung.png" alt={samsung.name} />
            </div>

            <div className="battle-rope-track">
              <div className={`battle-rope ${ropeFlowClass}`} />
              <div className="battle-center-mark" />
              <div className="battle-knot" style={{ left: `${knotLeft}%` }}>
                <div className="battle-knot-flag" />
              </div>
            </div>

            <div className={`battle-character battle-character-right ${!samsungWinning ? "pulling" : "losing"}`}>
              <img src="/img/boo_sk.png" alt={skhynix.name} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
