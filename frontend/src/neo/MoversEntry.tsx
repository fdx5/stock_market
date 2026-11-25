import { useEffect, useState } from "react";
import { api, type MoverEntry, type MoversEdition } from "../api/client";
import { Link } from "../router";
import { reportHotIssue } from "../useActivityTracking";
import "./movers.css";

const latest: Partial<Record<"kr" | "us", Promise<MoversEdition>>> = {};
const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;

/** A one-line way into 급등·급락 이유: this stock's own reason when it is on the latest list, else that market's headline. */
export default function MoversEntry({ code, place, market = "kr" }: { code?: string; place: string; market?: "kr" | "us" }) {
  const [entry, setEntry] = useState<MoverEntry | null>(null);
  const [edition, setEdition] = useState<MoversEdition | null>(null);
  useEffect(() => {
    let live = true;
    if (code && /^[A-Za-z0-9.]{1,12}$/.test(code)) api.moverForStock(code).then(r => { if (live) setEntry(r.entry); }).catch(() => {});
    const pending = latest[market] ??= api.movers(market).catch(e => { delete latest[market]; throw e; });
    pending.then(d => { if (live) setEdition(d); }).catch(() => {});
    return () => { live = false; };
  }, [code, market]);
  if (entry) {
    const up = entry.direction === "up";
    return <Link to={`${entry.path}#m-${code}`} className={`mv-entry ${up ? "is-up" : "is-down"}`} onClick={() => reportHotIssue(`movers:entry-${place}`, entry.name)}>
      <span className="mv-entry-tag">{entry.limit || (up ? "급등" : "급락")} {pct(entry.change_pct)}</span>
      <span className="mv-entry-text"><b>{entry.name}, {up ? "왜 올랐나" : "왜 내렸나"}</b><span>{entry.reason}</span></span>
      <span className="mv-entry-go">이유 보기</span>
    </Link>;
  }
  if (!edition?.stocks?.length || !edition.headline) return null;
  const top = edition.stocks.filter(s => s.direction === "up").slice(0, 3).map(s => `${s.name} ${pct(s.change_pct)}`).join(" · ");
  return <Link to={market === "us" ? "/movers/us" : "/movers"} className="mv-entry" onClick={() => reportHotIssue(`movers:entry-${place}`, edition.headline ?? "")}>
    <span className="mv-entry-tag">{market === "us" ? "나스닥100" : edition.slot_label} 급등·급락</span>
    <span className="mv-entry-text"><b>{edition.headline}</b><span>{top}</span></span>
    <span className="mv-entry-go">이유 보기</span>
  </Link>;
}
