import { useEffect, useState } from "react";
import { MonthlySupporter } from "../adminApi";
import { useMediaQuery } from "../useMediaQuery";
import { useL } from "./lib";

function currentMonth() {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}`;
}

export default function SupporterTicker() {
  const L = useL();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [month, setMonth] = useState(currentMonth);
  const [items, setItems] = useState<MonthlySupporter[]>([]);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const abort = new AbortController();
    let pending = false;
    async function load() {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const response = await fetch("/api/support/supporters", { signal: abort.signal, cache: "no-store" });
        if (!response.ok) throw new Error();
        const result: { month: string; items: MonthlySupporter[] } = await response.json();
        setMonth(result.month); setItems(result.items); setStatus("ready");
        setActive(index => result.items.length ? index % result.items.length : 0);
      } catch { if (!abort.signal.aborted) setStatus("error"); }
      finally { pending = false; }
    }
    load();
    const id = window.setInterval(load, 60000);
    document.addEventListener("visibilitychange", load);
    return () => { abort.abort(); clearInterval(id); document.removeEventListener("visibilitychange", load); };
  }, []);

  useEffect(() => {
    if (paused || hovered || reduced || items.length < 2) return;
    const interval = window.setInterval(() => { if (!document.hidden) setActive(index => (index + 1) % items.length); }, 4000);
    return () => clearInterval(interval);
  }, [paused, hovered, reduced, items.length]);

  const selected = items[active];
  return <aside className={`coffee-supporter-board${reduced ? " is-reduced" : ""}`} aria-labelledby="coffee-supporter-title" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setHovered(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setHovered(false); }}>
    <div className="coffee-supporter-top"><h3 id="coffee-supporter-title"><span aria-hidden="true">✦</span> {L(`${Number(month.slice(5))}월 후원자분`, `${new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en", { month: "long", timeZone: "UTC" })} supporters`)}</h3>{items.length > 1 && !reduced && <button type="button" className="coffee-supporter-pause" aria-label={paused ? L("후원자 전광판 재생", "Play supporter display") : L("후원자 전광판 일시정지", "Pause supporter display")} aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? "▶" : "Ⅱ"}</button>}</div>
    <div className="coffee-supporter-display" aria-hidden="true">
      {reduced ? <div className="coffee-supporter-static">{items.map(item => <span key={item.id} className={`coffee-supporter-name is-${item.color}`}>{item.nickname}</span>)}</div> : selected && <span key={selected.id} className={`coffee-supporter-name is-${selected.color}`}>{selected.nickname}</span>}
      {!items.length && <span className="coffee-supporter-empty">{status === "loading" ? L("따뜻한 마음을 불러오는 중…", "Loading your kindness…") : status === "error" ? L("잠시 후 다시 찾아올게요", "We’ll be back shortly") : L("첫 응원을 기다리고 있어요", "Waiting for our first kind supporter")}</span>}
    </div>
    <p className="coffee-supporter-thanks">{L("함께해 주셔서 고맙습니다", "Thank you for being here")} <span aria-hidden="true">♡</span>{items.length > 1 && !reduced && <small>{active + 1} / {items.length}</small>}</p>
    <ul className="sr-only" aria-label={L("이번 달 후원자 명단", "This month’s supporters")}>{items.map(item => <li key={item.id}>{item.nickname} · {item.color === "gold" ? L("금색", "Gold") : L("은색", "Silver")}</li>)}</ul>
  </aside>;
}
