import { useEffect, useState } from "react";
import { GlobalTop20Item, api } from "../api/client";
import RollingValue from "./RollingValue";

const POLL_MS = 5000;

function formatMarcapUsd(usd: number): string {
  if (usd >= 1_000_000_000_000) return `$${(usd / 1_000_000_000_000).toFixed(2)}T`;
  return `$${(usd / 1_000_000_000).toFixed(1)}B`;
}

function formatChangePct(changePct: number): string {
  return `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;
}

function changeClass(changePct: number): string {
  if (changePct > 0) return "change-up";
  if (changePct < 0) return "change-down";
  return "change-flat";
}

function isHighlighted(code: string): boolean {
  return code.startsWith("005930") || code.startsWith("000660");
}

export default function GlobalTop20() {
  const [items, setItems] = useState<GlobalTop20Item[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = () => {
      api
        .globalTop20()
        .then((res) => {
          if (cancelled) return;
          setItems(res.items);
          setError(null);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          setError(err.message || "데이터를 불러오지 못했습니다.");
        });
    };

    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="global-top20">
      <div className="global-top20-header">🌍 글로벌 시가총액 TOP 20</div>

      {error && <div className="error-state">{error}</div>}
      {items.length === 0 && !error && <div className="loading-state">데이터를 불러오는 중...</div>}

      {items.length > 0 && (
        <div className="global-top20-list">
          {items.map((item) => (
            <div key={item.code} className={`global-top20-row ${isHighlighted(item.code) ? "highlight" : ""}`}>
              <span className="global-top20-rank">{item.rank}</span>
              {item.logo_url && <img className="global-top20-logo" src={item.logo_url} alt={item.name} />}
              <span className="global-top20-name">{item.name}</span>
              <span className="global-top20-marcap">
                <RollingValue value={item.marcap_usd} text={formatMarcapUsd(item.marcap_usd)} />
              </span>
              {item.change_pct !== null && (
                <span className={`global-top20-change ${changeClass(item.change_pct)}`}>
                  <RollingValue value={item.change_pct} text={formatChangePct(item.change_pct)} />
                </span>
              )}
              {item.flag_url && <img className="global-top20-flag" src={item.flag_url} alt={item.country} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
