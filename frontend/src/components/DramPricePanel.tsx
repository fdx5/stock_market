import { useEffect, useState } from "react";
import { DramPriceItem, api } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import { pct } from "../mapTile";

// 반도체/전자(KR) · Information Technology(US) 종목의 상세 페이지에서만 의미가 있는
// 패널이라, 매번 종목이 바뀔 때만 다시 확인하면 충분하다 — 배치는 하루 한 번만
// 갱신되므로 폴링은 두지 않는다.
const TARGET_SECTOR: Record<"KR" | "US", string> = {
  KR: "반도체/전자",
  US: "Information Technology",
};

/** D램 현물가격 패널: 선택된 종목의 업종이 대상 업종(KR: 반도체/전자, US: Information
 * Technology)일 때만, 일일 배치가 마지막으로 적재한 TrendForce 현물가 스냅샷을
 * 항목별 표로 보여준다. 추이 그래프는 날짜별 데이터가 충분히 쌓인 뒤 추가할 예정이라
 * 지금은 최신 스냅샷 리스트만 그린다. */
export default function DramPricePanel({ code, market }: { code: string; market: "KR" | "US" }) {
  const t = useT();
  const [sector, setSector] = useState<string | null>(null);
  const [priceDate, setPriceDate] = useState<string | null>(null);
  const [items, setItems] = useState<DramPriceItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Default open — this is meant to be seen the moment a 반도체/전자 종목's page
  // loads, not discovered behind a fold — but foldable so a returning visitor who
  // already knows the numbers can collapse it out of the way.
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setSector(null);
    setLoaded(false);

    const sectorLookup = market === "US" ? api.usSector(code) : api.sector(code);

    sectorLookup
      .then((res) => {
        if (cancelled) return;
        setSector(res.sector);
        if (res.sector !== TARGET_SECTOR[market]) {
          setLoaded(true);
          return;
        }
        api
          .dramPrice()
          .then((dram) => {
            if (cancelled) return;
            setPriceDate(dram.price_date);
            setItems(dram.items);
          })
          .catch(() => {
            // A failed price fetch just leaves the panel showing nothing — the
            // sector header alone isn't worth an error row over.
          })
          .finally(() => {
            if (!cancelled) setLoaded(true);
          });
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [code, market]);

  if (!loaded || sector !== TARGET_SECTOR[market] || items.length === 0) return null;

  return (
    <div className="card dram-price-panel">
      <div className="dram-price-head">
        <span className="dram-price-title">{t("D램 현물가격")}</span>
        {priceDate && <span className="dram-price-date">{t("기준일")} {priceDate}</span>}
        <button
          type="button"
          className="indicator-panel-toggle dram-price-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? t("접기") : t("펼치기")}
          <span className={`fold-toggle-arrow ${expanded ? "up" : ""}`} aria-hidden="true">
            ▼
          </span>
        </button>
      </div>
      <div className={`dram-price-body ${expanded ? "expanded" : ""}`}>
        <div className="dram-price-table-wrap">
          <table className="dram-price-table">
            <thead>
              <tr>
                <th>{t("품목")}</th>
                <th>{t("가격")} (USD)</th>
                <th>{t("일중 고가")}</th>
                <th>{t("일중 저가")}</th>
                <th>{t("변동률")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const change = item.change_pct ?? 0;
                return (
                  <tr key={item.item_name}>
                    <td className="dram-price-item-name">{item.item_name}</td>
                    <td>${item.price.toFixed(3)}</td>
                    <td>{item.daily_high != null ? `$${item.daily_high.toFixed(2)}` : "—"}</td>
                    <td>{item.daily_low != null ? `$${item.daily_low.toFixed(2)}` : "—"}</td>
                    <td className={change > 0 ? "change-up" : change < 0 ? "change-down" : "change-flat"}>
                      {pct(change)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
