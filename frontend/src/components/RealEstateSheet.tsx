import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  api,
  RealEstateFacts,
  RealEstateItem,
  RealEstatePeriod,
  RealEstateRentResponse,
  RealEstateTradeHistory,
  RealEstateTypeView,
} from "../api/client";
import { useBodyScrollLock } from "../useBodyScrollLock";
import RealEstatePopup, { OtherType, PopupContext } from "./RealEstatePopup";
import RealEstateRentView, { LeaseMode } from "./RealEstateRentView";
import { useDialogFocus } from "./realEstateTools";

/* The 부동산 맵's pinned complex card — a bottom sheet on a phone or tablet, a centred
 * dialog on a desktop. It opens on a click or tap on a tile, shows what the hover
 * card shows, and adds what a hover card cannot hold: a 평형 selector that re-lays
 * the whole card out for the chosen 평형, and the button into the complex's 구 or 동.
 *
 * The map only carries the 대표 평형; the other 평형 are fetched once, when the card
 * opens (GET /api/realestate/complex). */

/** Where to see today's listings and asking prices. 국토교통부 publishes signed
 * contracts only, so the card sends the reader to the listing services themselves —
 * linking, never copying their listings. KB부동산 has no address that takes a
 * search, so it is left out. */

const ROMAN: Record<string, string> = { Ⅰ: "1", Ⅱ: "2", Ⅲ: "3", Ⅳ: "4", Ⅴ: "5" };

/** A 실거래 name as a search word: roman numerals as digits, "I-PARK" as 아이파크,
 * building lists "(10,11동)" and lot numbers "(1009-4)" dropped, any other
 * parenthesised word kept inline ("상록마을(우성)1" → "상록마을우성1"). */
function searchName(name: string): string {
  return name
    .replace(/[ⅠⅡⅢⅣⅤ]/g, (c) => ROMAN[c])
    .replace(/\([^)]*동\)|\([\d\s,~-]+\)/g, "")
    .replace(/I-?PARK/gi, "아이파크")
    .replace(/[()\s]/g, "");
}

/** 네이버 부동산's search opens a complex only by the name it knows. 실거래 drops
 * the 차 of a 차수 ("신도6", "개포우성2" are 신도6차, 개포우성2차), so a closing
 * one- or two-digit number right after Hangul gets its 차 back — and nothing else
 * does: "PH129" or "현대아이파크1" are left as written. Tried against 240 complexes
 * in seven districts, this opened 167 directly and made none worse. */
function naverWords(item: RealEstateItem): string {
  const name = searchName(item.name);
  return `${item.dong} ${/[가-힣]\d{1,2}$/.test(name) ? `${name}차` : name}`.trim();
}

function ListingLinks({ item }: { item: RealEstateItem }) {
  const plain = `${item.dong} ${searchName(item.name)}`.trim();
  const links = [
    { label: "네이버 부동산", sub: "매물·호가", href: `https://m.land.naver.com/search/result/${encodeURIComponent(naverWords(item))}`, cls: "is-naver" },
    { label: "호갱노노", sub: "매물·시세", href: `https://hogangnono.com/search?q=${encodeURIComponent(plain)}`, cls: "is-hogang" },
  ];
  // 네이버's general search matches loosely and shows the complex's card with its
  // listings; it finds most of what the 부동산 search misses by name.
  const fallback = `https://search.naver.com/search.naver?query=${encodeURIComponent(`${plain} 아파트`)}`;
  return (
    <section className="re-sheet-links" aria-label="현재 매물과 호가">
      <h4>현재 매물·호가 보기</h4>
      <div>
        {links.map((l) => (
          <a key={l.label} className={l.cls} href={l.href} target="_blank" rel="noopener noreferrer">
            <b>{l.label}</b>
            <small>{l.sub}</small>
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        ))}
      </div>
      <p className="re-sheet-links-alt">
        네이버 부동산에서 단지가 바로 열리지 않으면{" "}
        <a href={fallback} target="_blank" rel="noopener noreferrer">
          네이버 통합검색에서 찾기 ↗
        </a>
      </p>
      <p>국토교통부 자료에는 매물 정보가 없어, 현재 호가는 부동산 서비스에서 확인할 수 있습니다. 새 창으로 열립니다.</p>
    </section>
  );
}

const PYEONG = 3.3058;

/** The 대표 평형's key among the fetched ones: the one whose area rounds the same. */
function representativeKey(item: RealEstateItem, views: RealEstateTypeView[]): number | null {
  if (views.length === 0) return null;
  const exact = views.find((v) => v.key === Math.round(item.area));
  if (exact) return exact.key;
  return views.reduce((best, v) => (Math.abs(v.area - item.area) < Math.abs(best.area - item.area) ? v : best)).key;
}

export default function RealEstateSheet({
  item,
  ctx,
  period,
  goLabel,
  onGo,
  onClose,
  saved, compared, onSave, onCompare, compareCount, onOpenCompare, feedback,
}: {
  item: RealEstateItem;
  ctx: PopupContext;
  period: RealEstatePeriod;
  /** e.g. "도곡동 지도로 이동"; null when the map is already at the complex's 동. */
  goLabel: string | null;
  onGo: () => void;
  onClose: () => void;
  saved: boolean;
  compared: boolean;
  onSave: (item: RealEstateItem) => void;
  onCompare: (item: RealEstateItem) => void;
  /** How many complexes are picked for comparison; the card offers to open them. */
  compareCount: number;
  onOpenCompare: () => void;
  feedback?: string;
}) {
  useBodyScrollLock(true);
  const dialogRef = useDialogFocus(onClose);
  const [retry, setRetry] = useState(0);
  const [shareNote, setShareNote] = useState("");

  const [views, setViews] = useState<RealEstateTypeView[]>([]);
  const [history, setHistory] = useState<RealEstateTradeHistory | undefined>(undefined);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    api
      .realEstateComplex(item.id, period)
      .then((res) => {
        if (cancelled) return;
        setViews(res.types);
        setHistory(res.history);
        const requested = Number(new URLSearchParams(location.search).get("area"));
        setSelected(res.types.some(t => t.key === requested) ? requested : representativeKey(item, res.types));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item, period, retry]);

  // 세대수·주차 come from K-apt through their own request, so a slow or missing
  // lookup never holds up the 평형 data.
  // 매매 is the card's default; 전세 and 월세 are read (and, for a district never
  // opened this way, collected) only once the reader asks for them.
  const [mode, setMode] = useState<"sale" | LeaseMode>(() => {
    const value = new URLSearchParams(location.search).get("mode");
    return value === "jeonse" || value === "wolse" ? value : "sale";
  });
  const [rent, setRent] = useState<RealEstateRentResponse | null>(null);
  const [rentFailed, setRentFailed] = useState(false);
  useEffect(() => {
    setRent(null);
    setRentFailed(false);
  }, [item.id]);
  useEffect(() => {
    if (mode === "sale") return;
    let cancelled = false;
    let timer = 0;
    const load = () => {
      api
        .realEstateRent(item.id)
        .then((res) => {
          if (cancelled) return;
          setRent(res);
          setRentFailed(false);
          // While the district's leases are still coming in, ask again.
          if (res.status.collecting) timer = window.setTimeout(load, 5000);
        })
        .catch(() => {
          if (!cancelled) setRentFailed(true);
        });
    };
    load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, item.id, retry]);
  useEffect(() => {
    if (selected === null) return;
    const q = new URLSearchParams(location.search);
    q.set("complex", item.id); q.set("area", String(selected));
    if (mode === "sale") q.delete("mode"); else q.set("mode", mode);
    window.history.replaceState(window.history.state, "", `${location.pathname}?${q}`);
  }, [selected, mode, item.id]);

  const [facts, setFacts] = useState<RealEstateFacts | null>(null);
  useEffect(() => {
    let cancelled = false;
    setFacts(null);
    api
      .realEstateFacts(item.id)
      .then((res) => {
        if (!cancelled) setFacts(res);
      })
      .catch((e: Error) => {
        if (!cancelled) setFacts({ id: item.id, matched: false, households: null, parking: null, parking_per_household: null, error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, retry]);

  const view = views.find((v) => v.key === selected) ?? null;
  const repKey = useMemo(() => representativeKey(item, views), [item, views]);

  // The card reads the selected 평형 wherever it reads the 대표 평형; the complex-wide
  // figures (name, 준공, 1년 거래 건수, rank) stay the item's.
  const shown: RealEstateItem = view ? { ...item, ...view, trades_1y: item.trades_1y } : item;
  const others: OtherType[] | undefined = views.length
    ? views
        .filter((v) => v.key !== selected)
        .map((v) => ({ key: v.key, area: v.area, price: v.price, date: v.deal_date, trades_1y: v.trades_1y }))
    : undefined;

  const modeSwitch = (
    <div className="re-sheet-mode" role="tablist" aria-label="거래 종류">
      {(
        [
          ["sale", "매매"],
          ["jeonse", "전세"],
          ["wolse", "월세"],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={mode === key}
          data-mode={key}
          className={mode === key ? "is-on" : ""}
          onClick={() => setMode(key)}
          onKeyDown={e => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const modes = ["sale", "jeonse", "wolse"] as const;
            const next = (modes.indexOf(mode) + (e.key === "ArrowRight" ? 1 : 2)) % 3;
            setMode(modes[next]);
            const target = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next];
            target?.focus();
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const selector = (
    <div className="re-sheet-select">
      <label htmlFor="re-sheet-pyeong">평형</label>
      <select
        id="re-sheet-pyeong"
        value={selected ?? ""}
        disabled={loading || views.length < 2}
        onChange={(e) => setSelected(Number(e.target.value))}
      >
        {views.length === 0 && (
          <option value="">
            전용 {Math.round(item.area)}㎡ ({item.pyeong}평){loading ? " · 불러오는 중…" : ""}
          </option>
        )}
        {views.map((v) => (
          <option key={v.key} value={v.key}>
            전용 {v.area}㎡ ({(v.area / PYEONG).toFixed(1)}평) · {v.key === repKey ? "대표 · " : ""}1년 {v.trades_1y}건
          </option>
        ))}
      </select>
      {failed && <span className="re-sheet-select-note">다른 평형을 불러오지 못했습니다 <button type="button" onClick={() => setRetry(x => x + 1)}>다시 시도</button></span>}
      {!loading && !failed && views.length === 1 && <span className="re-sheet-select-note">거래된 평형이 하나뿐입니다</span>}
    </div>
  );

  // Rendered on <body>: the page box (.d2) is a size container, which some browsers
  // treat as the containing block of fixed descendants, so a card opened from far
  // down a long table was centred on the page rather than on the screen. The
  // wrapper (display: contents) keeps the page's classes for their styles.
  return createPortal(
    <div className="d2 mm app kospi-map-page re-map-page re-sheet-portal" lang="ko">
      <div className="re-sheet-scrim" onClick={onClose}>
        <section
          ref={dialogRef}
          tabIndex={-1}
          className="re-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={`${item.name} 상세 정보`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="re-sheet-grip" aria-hidden="true" />
          <button type="button" className="re-sheet-close" onClick={onClose} aria-label="닫기">
            ×
          </button>
          <div className="re-sheet-body re-pop-tip">
            <div className="re-detail-tools">
              <button type="button" aria-pressed={saved} onClick={() => onSave(shown)}>{saved ? "★ 관심 저장됨" : "☆ 관심 저장"}</button>
              <button type="button" aria-pressed={compared} onClick={() => onCompare(shown)}>{compared ? "✓ 비교 선택됨" : "+ 비교 추가"}</button>
              {compareCount > 0 && <button type="button" className="re-primary" onClick={onOpenCompare}>비교하기 ({compareCount})</button>}
              <button type="button" onClick={async () => {
                try { await navigator.clipboard.writeText(location.href); setShareNote("이 단지·평형의 링크를 복사했습니다."); }
                catch { setShareNote("주소창의 링크를 복사하면 이 단지와 평형을 공유할 수 있습니다."); }
              }}>링크 복사</button>
            </div>
            {(shareNote || feedback) && <p className="re-detail-note" role="status">{shareNote || feedback}</p>}
            {loading && <p className="re-detail-note" role="status">최신 평형 정보를 확인하고 있습니다…</p>}
            <RealEstatePopup
              item={shown}
              ctx={{ ...ctx, clickHint: null }}
              selector={selector}
              others={others}
              onPickType={views.length ? setSelected : undefined}
              modeSwitch={modeSwitch}
              replaceBody={
                mode === "sale" ? undefined : (
                  <RealEstateRentView
                    mode={mode}
                    data={rent}
                    failed={rentFailed}
                    typeKey={selected ?? Math.round(item.area)}
                    area={shown.area}
                    salePrice={shown.price}
                    saleDate={shown.deal_date}
                    onRetry={() => setRetry(x => x + 1)}
                  />
                )
              }
              facts={facts}
              deals={view?.deals}
              history={history}
            />
            <ListingLinks item={item} />
          </div>
          <footer className="re-sheet-actions">
            {goLabel && (
              <button type="button" className="re-sheet-go" onClick={onGo}>
                {goLabel}
              </button>
            )}
            <button type="button" className="re-sheet-dismiss" onClick={onClose}>
              닫기
            </button>
          </footer>
        </section>
      </div>
    </div>,
    document.body,
  );
}
