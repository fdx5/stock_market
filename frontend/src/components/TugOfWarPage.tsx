import { useEffect, useState } from "react";
import { BattleSide, api } from "../api/client";
import { Link } from "../router";
import VisitorBadge from "./VisitorBadge";

const POLL_MS = 3000;

const ENGLISH_NAME: Record<string, string> = {
  "005930": "SAMSUNG ELECTRONICS",
  "000660": "SK HYNIX",
};

function formatMarcap(marcap: number): string {
  return `${(marcap / 1_000_000_000_000).toFixed(1)}조`;
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
  const samsungWinning = samsungPct >= skhynixPct;

  // Bars are normalized to the leader so a close 52/48 split still reads visually,
  // while the printed percentages carry the precise figures.
  const barMax = Math.max(samsungPct, skhynixPct);
  const samsungBarHeight = barMax > 0 ? (samsungPct / barMax) * 100 : 0;
  const skhynixBarHeight = barMax > 0 ? (skhynixPct / barMax) * 100 : 0;

  const leader = samsung && skhynix ? (samsungWinning ? samsung : skhynix) : null;
  const trailing = samsung && skhynix ? (samsungWinning ? skhynix : samsung) : null;
  const diffMarcap = samsung && skhynix ? Math.abs(samsung.marcap - skhynix.marcap) / 1_000_000_000_000 : 0;
  const diffPct = Math.abs(samsungPct - skhynixPct);

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

      {samsung && skhynix && leader && trailing && (
        <div className="battle-arena-wrap">
          <div className="battle-marcap-row">
            <div className="battle-marcap-block">
              <div className="battle-marcap-label">{samsung.name}</div>
              <div className="battle-marcap-value">{formatMarcap(samsung.marcap)}</div>
            </div>
            <div className="battle-marcap-block right">
              <div className="battle-marcap-label">{skhynix.name}</div>
              <div className="battle-marcap-value">{formatMarcap(skhynix.marcap)}</div>
            </div>
          </div>

          <div className="battle-bar-chart">
            <div className="battle-bar-col">
              <div className="battle-bar-pct">{samsungPct.toFixed(1)}%</div>
              <div className="battle-bar-track">
                <div
                  className={`battle-bar ${samsungWinning ? "winning" : ""}`}
                  style={{ height: `${samsungBarHeight}%` }}
                />
              </div>
              <div className="battle-bar-name">{samsung.name}</div>
            </div>
            <div className="battle-bar-col">
              <div className="battle-bar-pct">{skhynixPct.toFixed(1)}%</div>
              <div className="battle-bar-track">
                <div
                  className={`battle-bar ${!samsungWinning ? "winning" : ""}`}
                  style={{ height: `${skhynixBarHeight}%` }}
                />
              </div>
              <div className="battle-bar-name">{skhynix.name}</div>
            </div>
          </div>

          <div className="battle-video-wrap">
            <video className="battle-video" src="/video/zzanggu.mp4" autoPlay loop muted playsInline />
            <div className="battle-rank1-name">{ENGLISH_NAME[leader.code] ?? leader.name}</div>
            <div className="battle-rank2-info">
              2위 {trailing.name} · {diffMarcap.toFixed(1)}조 차이 ({diffPct.toFixed(1)}%)
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
