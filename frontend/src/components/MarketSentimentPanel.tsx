import { useEffect, useState, type CSSProperties } from "react";
import "./marketSentiment.css";

type Item = { key: string; name: string; score: number | null; message: string };

const label = (n: number) => n <= 20 ? "극단적 공포" : n <= 40 ? "공포" : n <= 60 ? "중립" : n <= 80 ? "탐욕" : "극단적 탐욕";

// Colour band, matching label()'s own boundaries. The colour used to switch at 50 while
// the label switched at 40/60, so a 45 read "중립" in fear-blue and a 55 read "중립" in
// greed-red — the two halves of the same row disagreeing about the same number.
//
// The colours themselves live in marketSentiment.css, not here: 중립 needs a different
// green in light and dark mode to stay legible against each surface, and an inline style
// cannot express that.
const tone = (n: number) => (n <= 40 ? "fear" : n <= 60 ? "neutral" : "greed");
function kosdaqScore(points: Array<{ close?: number }>): number | null {
  const a = points.map((p) => Number(p.close)).filter(Number.isFinite); if (a.length < 30) return null;
  const r = a.slice(-20); const mean = r.reduce((x, y) => x + y, 0) / r.length;
  const momentum = ((a[a.length - 1] / mean) - 1) * 50 + 50;
  const vol = Math.sqrt(r.slice(1).reduce((s, v, i) => s + ((v / r[i]) - 1) ** 2, 0) / (r.length - 1)) * 100;
  return Math.round(Math.max(0, Math.min(100, momentum - Math.max(0, vol - 1.5) * 8)));
}

export default function MarketSentimentPanel({ en = false }: { en?: boolean }) {
  const [items, setItems] = useState<Item[]>([
    { key: "kospi", name: "KOSPI", score: null, message: "시장 온도 측정 중" },
    { key: "kosdaq", name: "KOSDAQ", score: null, message: "시장 온도 측정 중" },
    { key: "sp500", name: "S&P 500", score: null, message: "시장 온도 측정 중" },
  ]);
  useEffect(() => {
    const c = new AbortController();
    Promise.allSettled([
      fetch("https://kospi.feargreedchart.com/api/?action=kospi", { signal: c.signal }).then((r) => r.json()),
      fetch("https://feargreedchart.com/api/?action=all", { signal: c.signal }).then((r) => r.json()),
      fetch("/api/market/index/KOSDAQ/history?years=1", { signal: c.signal }).then((r) => r.json()),
    ]).then(([kr, us, kd]) => {
      if (c.signal.aborted) return;
      const k = kr.status === "fulfilled" && Number.isFinite(+kr.value?.score) ? +kr.value.score : null;
      const s = us.status === "fulfilled" && Number.isFinite(+us.value?.score?.score) ? +us.value.score.score : null;
      const d = kd.status === "fulfilled" ? kosdaqScore(kd.value?.points ?? []) : null;
      setItems([
        { key: "kospi", name: "KOSPI", score: k, message: k == null ? "데이터 대기" : k > 50 ? "상승 기대가 과열되는지 살펴보세요" : "방어 심리가 강한 구간입니다" },
        { key: "kosdaq", name: "KOSDAQ", score: d, message: d == null ? "데이터 대기" : d > 50 ? "성장주 쪽 위험선호가 살아 있습니다" : "변동성에 유의할 구간입니다" },
        { key: "sp500", name: "S&P 500", score: s, message: s == null ? "데이터 대기" : s > 50 ? "미국 주식의 낙관 심리가 우세합니다" : "미국 시장이 보수적으로 움직입니다" },
      ]);
    });
    return () => c.abort();
  }, []);
  return <section className="desk-sentiment" aria-label={en ? "Market sentiment" : "시장 공포 탐욕 지수"}>
    <header><span>공포·탐욕 지수</span><small>{en ? "0 fear · 100 greed" : "0 공포 · 100 탐욕"}</small></header>
    <div className="desk-sentiment-list">{items.map((x) => {
      const n = x.score ?? 0;
      // A missing score gets its own tone rather than falling through to 0, which
      // rendered "데이터 대기" as an empty ring in extreme-fear blue.
      return <article key={x.key} data-tone={x.score == null ? "unknown" : tone(n)}>
        <div className="desk-sentiment-donut" style={{ "--sentiment-angle": `${n * 3.6}deg` } as CSSProperties}><strong>{x.score ?? "—"}</strong></div>
        <div className="desk-sentiment-copy"><div><b>{x.name}</b><em>{x.score == null ? "측정 중" : label(n)}</em></div><p>{x.message}</p></div>
      </article>;
    })}</div>
  </section>;
}
