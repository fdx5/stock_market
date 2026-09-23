import { useEffect, useRef, useState } from "react";
import { DramPriceItem, FuturesItem, api } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link } from "../router";
import CommodityIcon from "../components/CommodityIcon";
import { Marker, Skel } from "./parts";
import { pct, toneOf, useL } from "./lib";

/* 09 원자재 · 산업 지표.
 *
 * The 27 commodity futures and the memory spot prices, the same two boards the
 * classic desk carried. Futures poll every ten seconds and only a row whose
 * price actually moved flashes; the whole table is filterable by group now, so
 * a reader after the metals does not scroll past the grains. */

type Tab = "futures" | "dram";

const GROUPS: { id: string; ko: string; en: string }[] = [
  { id: "all", ko: "전체", en: "All" },
  { id: "energy", ko: "에너지", en: "Energy" },
  { id: "metal", ko: "금속", en: "Metals" },
  { id: "crop", ko: "곡물·소프트", en: "Grains & softs" },
  { id: "live", ko: "축산·기타", en: "Livestock & other" },
];

const ENERGY = new Set(["crude", "brent", "gas", "heating-oil", "gasoline"]);
const METAL = new Set(["gold", "silver", "platinum", "palladium", "copper", "aluminum"]);
const LIVE = new Set(["cattle", "feeder-cattle", "hog", "lumber"]);

/** Classified by the icon key the backend already assigns each contract. */
function groupOf(item: FuturesItem): string {
  if (ENERGY.has(item.icon)) return "energy";
  if (METAL.has(item.icon)) return "metal";
  if (LIVE.has(item.icon)) return "live";
  return "crop";
}

function Futures() {
  const { lang } = useLanguage();
  const L = useL();
  const [items, setItems] = useState<FuturesItem[]>([]);
  const [failed, setFailed] = useState(false);
  const [flash, setFlash] = useState<Record<string, "up" | "down">>({});
  const [group, setGroup] = useState("all");
  const ref = useRef<FuturesItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    const load = () =>
      api
        .futures()
        .then((res) => {
          if (cancelled) return;
          if (res.items.length === 0) {
            if (ref.current.length === 0) setFailed(true);
            return;
          }
          setFailed(false);
          const before = new Map(ref.current.map((i) => [i.symbol, i.price]));
          const same =
            ref.current.length === res.items.length &&
            res.items.every((i, k) => ref.current[k].symbol === i.symbol && ref.current[k].price === i.price && ref.current[k].updated_at === i.updated_at);
          if (same) return;
          const moved: Record<string, "up" | "down"> = {};
          for (const i of res.items) {
            const b = before.get(i.symbol);
            if (b !== undefined && b !== i.price) moved[i.symbol] = i.price > b ? "up" : "down";
          }
          ref.current = res.items;
          setItems(res.items);
          if (Object.keys(moved).length) {
            setFlash((p) => ({ ...p, ...moved }));
            timers.push(
              window.setTimeout(() => {
                if (cancelled) return;
                setFlash((p) => {
                  const n = { ...p };
                  for (const s of Object.keys(moved)) delete n[s];
                  return n;
                });
              }, 900)
            );
          }
        })
        .catch(() => {
          if (!cancelled && ref.current.length === 0) setFailed(true);
        });
    load();
    const stop = startVisibilityAwareInterval(load, 10_000);
    return () => {
      cancelled = true;
      stop();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  if (items.length === 0) {
    return failed ? <p className="d2-empty">{L("선물 시세를 불러오지 못했습니다.", "Could not load futures.")}</p> : <Skel h={260} />;
  }

  const shown = group === "all" ? items : items.filter((i) => groupOf(i) === group);
  const time = (v: string) => {
    const d = new Date(v);
    return Number.isNaN(d.getTime())
      ? "—"
      : new Intl.DateTimeFormat(lang === "ko" ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  };

  return (
    <>
      <div className="d2-cmdty-filter" role="group" aria-label={L("품목 분류", "Group")}>
        {GROUPS.map((g) => (
          <button key={g.id} type="button" className={group === g.id ? "is-on" : ""} onClick={() => setGroup(g.id)}>
            {lang === "ko" ? g.ko : g.en}
            <small>{g.id === "all" ? items.length : items.filter((i) => groupOf(i) === g.id).length}</small>
          </button>
        ))}
      </div>
      <div className="d2-table-wrap d2-cmdty-scroll" tabIndex={0} role="region" aria-label={L("선물 시세표", "Futures table")}>
        <table className="d2-table d2-cmdty-table">
          <thead>
            <tr>
              <th className="is-name">{L("품목", "Contract")}</th>
              <th>{L("시장", "Exchange")}</th>
              <th>{L("현재가", "Last")}</th>
              <th>{L("대비", "Chg")}</th>
              <th>{L("등락률", "Chg %")}</th>
              <th>{L("갱신", "Updated")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => {
              const tone = toneOf(i.change_pct);
              return (
                <tr key={i.symbol} className={flash[i.symbol] ? `is-flash-${flash[i.symbol]}` : ""}>
                  <td className="is-name">
                    <span className="d2-cmdty-name">
                      <CommodityIcon icon={i.icon} />
                      <b>{lang === "en" ? i.name_en : i.name}</b>
                      <small>{i.unit}</small>
                    </span>
                  </td>
                  <td>
                    <span className="d2-cmdty-mkt">
                      <img src={`/img/flag/${i.flag}.svg`} alt="" loading="lazy" />
                      {i.market_name}
                    </span>
                  </td>
                  <td className="d2-num">{i.price.toFixed(i.decimals)}</td>
                  <td className={`d2-num is-${tone}`}>
                    {i.change > 0 ? "+" : ""}
                    {i.change.toFixed(i.decimals)}
                  </td>
                  <td className={`d2-num is-${tone}`}>{pct(i.change_pct)}</td>
                  <td className="d2-muted">{time(i.updated_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Dram() {
  const L = useL();
  const [date, setDate] = useState<string | null>(null);
  const [items, setItems] = useState<DramPriceItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api
      .dramPrice()
      .then((res) => {
        if (cancelled) return;
        setDate(res.price_date);
        setItems(res.items);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);
  if (!loaded) return <Skel h={200} />;
  if (items.length === 0) return <p className="d2-empty">{L("표시할 D램 현물가격이 없습니다.", "No DRAM spot prices to show.")}</p>;
  return (
    <>
      <div className="d2-table-wrap">
        <table className="d2-table">
          <thead>
            <tr>
              <th className="is-name">{L("품목", "Item")}</th>
              <th>{L("가격(USD)", "Price (USD)")}</th>
              <th>{L("일중 고가", "Day high")}</th>
              <th>{L("일중 저가", "Day low")}</th>
              <th>{L("등락률", "Chg %")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.item_name}>
                <td className="is-name">
                  <b>{i.item_name}</b>
                </td>
                <td className="d2-num">${i.price.toFixed(3)}</td>
                <td className="d2-num">{i.daily_high != null ? `$${i.daily_high.toFixed(2)}` : "—"}</td>
                <td className="d2-num">{i.daily_low != null ? `$${i.daily_low.toFixed(2)}` : "—"}</td>
                <td className={`d2-num is-${toneOf(i.change_pct)}`}>{pct(i.change_pct ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="d2-cmdty-foot">
        {date && (
          <span>
            {L("기준일", "As of")} {date} · TrendForce
          </span>
        )}
        <Link to="/dram-price" className="d2-more">
          {L("가격 이력 차트", "Price history")} →
        </Link>
      </p>
    </>
  );
}

export default function CommodityDesk() {
  const L = useL();
  const [tab, setTab] = useState<Tab>("futures");
  const [open, setOpen] = useState(true);
  return (
    <div className="d2-cmdty">
      <div className="d2-block-head">
        <Marker
          options={[
            { id: "futures", label: L("글로벌 선물 동향", "Global futures") },
            { id: "dram", label: L("메모리 현물 시세", "Memory spot prices") },
          ]}
          value={tab}
          onChange={(t) => {
            setTab(t);
            setOpen(true);
          }}
          label={L("원자재", "Commodities")}
        />
        <button type="button" className="d2-text-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? L("접기", "Collapse") : L("펼치기", "Expand")}
        </button>
      </div>
      {open && (tab === "futures" ? <Futures /> : <Dram />)}
    </div>
  );
}
