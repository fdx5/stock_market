import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link, navigate, useRoute } from "../router";
import { useWatchlist } from "../useWatchlist";
import DiscussionIcon from "./DiscussionIcon";
import StockLogo from "./StockLogo";
import "./recentStocksDock.css";

const MAX_ITEMS = 5;
const POLL_MS = 5_000;
const COLLAPSE_KEY = "kstock_recent_dock_collapsed";

// Two footprints, not one. A gutter this wide (roomy monitors, or a page
// whose own content stays under ~1300px) gets the full card — logo, name,
// code, price and change all on one row. A gutter too narrow for that but
// still real (this is the common case: 1920px next to the 1680px-wide desk/
// global/etf/ai-prediction pages, which leaves ~120px) gets a slimmer
// "compact" card instead — same four data points, stacked into a narrow
// column, name in place of code. Below COMPACT_MIN_GUTTER there just isn't
// room for either without overlapping the content beside it, so the dock
// renders nothing (which naturally covers every phone and tablet too, with
// no separate mobile check needed).
const FULL_WIDTH = 196;
const FULL_GAP_CONTENT = 20;
const FULL_GAP_EDGE = 16;
const FULL_MIN_GUTTER = FULL_WIDTH + FULL_GAP_CONTENT + FULL_GAP_EDGE;

const COMPACT_WIDTH = 92;
const COMPACT_GAP_CONTENT = 8;
const COMPACT_GAP_EDGE = 8;
const COMPACT_MIN_GUTTER = COMPACT_WIDTH + COMPACT_GAP_CONTENT + COMPACT_GAP_EDGE;

interface DockPos {
  left: number;
  top: number;
  compact: boolean;
}

interface LiveQuote {
  close: number;
  change: number;
  change_pct: number;
}

/** Floating "최근 본 종목" rail, docked in the empty margin a wide viewport
 * leaves outside the page's centered content column — never inside it.
 *
 * Mounted only on the reader-facing browsing/ranking pages — see
 * RECENT_DOCK_PATHS in App.tsx, which owns that allowlist. Positioning within
 * those pages is done by measuring the mounted page's own `.app` element
 * rather than any fixed offset, since each of them sets its own max-width
 * (1280 by default, 1680 on the desk/global/prediction pages, ...); the same
 * measurement decides which of two card designs fits the room available —
 * see FULL_MIN_GUTTER/COMPACT_MIN_GUTTER above — and only renders nothing
 * below the smaller of the two, which naturally covers phones and tablets
 * without a separate mobile check.
 *
 * `position: fixed` against the viewport is also the entire "follow while
 * scrolling" behavior — nothing else has to track scroll position for that. */
export default function RecentStocksDock() {
  const t = useT();
  const path = useRoute();
  const { recents } = useWatchlist();
  const items = recents.slice(0, MAX_ITEMS);
  const names = useTranslatedTexts(items.map((item) => item.name));

  const [dock, setDock] = useState<DockPos | null>(null);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const [flashes, setFlashes] = useState<Record<string, "up" | "down">>({});
  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;

  // Re-measures on mount, on window resize, whenever the mounted page's own
  // `.app` box changes size, and once more a beat after a route change (a
  // route swap remounts a differently-shaped `.app`, and its final width can
  // still be settling a frame later while fonts/images land).
  useEffect(() => {
    /* A window drag fires this on nearly every frame from two sources at once,
       and it used to hand React a fresh object each time — a re-render, and with
       it a DOM mutation the site-wide observers all wake up for, to move the rail
       to the position it was already in. The position is compared before it is
       stored, and the measuring is coalesced to one animation frame per burst. */
    let frame = 0;
    const clear = () =>
      setDock((current) => (current === null ? current : null));
    const publish = () => {
      frame = 0;
      const app = document.querySelector<HTMLElement>(".app");
      if (!app) {
        clear();
        return;
      }
      const rect = app.getBoundingClientRect();
      const gutter = window.innerWidth - rect.right;
      if (gutter < COMPACT_MIN_GUTTER) {
        clear();
        return;
      }
      const compact = gutter < FULL_MIN_GUTTER;
      const header = document.querySelector<HTMLElement>(".app-header");
      const headerH = header ? header.getBoundingClientRect().height : 72;
      const gapContent = compact ? COMPACT_GAP_CONTENT : FULL_GAP_CONTENT;
      const left = rect.right + gapContent,
        top = Math.max(24, headerH + 24);
      setDock((current) =>
        current &&
        current.left === left &&
        current.top === top &&
        current.compact === compact
          ? current
          : { left, top, compact },
      );
    };
    const measure = () => {
      if (!frame) frame = requestAnimationFrame(publish);
    };

    publish();
    const settleId = window.setTimeout(measure, 300);
    window.addEventListener("resize", measure);

    const app = document.querySelector(".app");
    const ro = app ? new ResizeObserver(measure) : null;
    if (app && ro) ro.observe(app);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(settleId);
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [path]);

  const codeKey = items.map((item) => `${item.market === "US" ? "US" : "KR"}:${item.code}`).join(",");

  useEffect(() => {
    if (!dock || !codeKey) return;
    let cancelled = false;
    const targets = codeKey.split(",").map((entry) => {
      const [side, code] = entry.split(":");
      return { code, us: side === "US" };
    });

    const poll = () => {
      targets.forEach(({ code, us }) => {
        (us ? api.usStockQuote(code) : api.quote(code))
          .then((quote) => {
            if (cancelled) return;
            const prevQuote = quotesRef.current[code];
            setQuotes((prev) => ({ ...prev, [code]: quote }));
            if (prevQuote && prevQuote.close !== quote.close) {
              const dir = quote.close > prevQuote.close ? "up" : "down";
              setFlashes((f) => ({ ...f, [code]: dir }));
              window.setTimeout(() => {
                setFlashes((f) => {
                  if (f[code] !== dir) return f;
                  const { [code]: _drop, ...rest } = f;
                  return rest;
                });
              }, 900);
            }
          })
          .catch(() => {
            // One stock failing to quote keeps its last known price rather than
            // blanking the whole rail.
          });
      });
    };

    poll();
    const stop = startVisibilityAwareInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [dock, codeKey]);

  if (!dock || items.length === 0) return null;

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // Best-effort: worst case the dock re-opens on next visit.
      }
      return next;
    });
  };

  const compact = dock.compact;

  return (
    <aside
      className={`recent-dock ${compact ? "recent-dock--compact" : ""}`}
      style={{ left: dock.left, top: dock.top }}
      aria-label={t("최근 본 종목")}
    >
      <button
        type="button"
        className="recent-dock-head"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        title={t("최근 본 종목")}
      >
        <span className="recent-dock-head-icon" aria-hidden="true">🕘</span>
        {!compact && <span className="recent-dock-head-label">{t("최근 본 종목")}</span>}
        <span className="recent-dock-live-dot" aria-hidden="true" />
        <span className={`recent-dock-chevron ${collapsed ? "is-collapsed" : ""}`} aria-hidden="true">
          ›
        </span>
      </button>

      {!collapsed && (
        <div className="recent-dock-list">
          {items.map((item, idx) => {
            const quote = quotes[item.code];
            const flash = flashes[item.code];
            const isUs = item.market === "US";
            const up = !!quote && quote.change > 0;
            const down = !!quote && quote.change < 0;
            const changeClass = up ? "is-up" : down ? "is-down" : "is-flat";
            const arrow = up ? "▲" : down ? "▼" : "•";
            const priceText = quote
              ? isUs
                ? `$${quote.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : quote.close.toLocaleString("ko-KR")
              : null;
            const pctText = quote ? `${arrow} ${Math.abs(quote.change_pct).toFixed(2)}%` : null;
            // Fills the gap the price row's right-alignment leaves on the left (see
            // recentStocksDock.css's .recent-dock-card-price-line) with the one quote
            // field the card doesn't already show anywhere: the absolute won/dollar
            // move, as opposed to the % the card already had.
            const changeAmountText = quote
              ? isUs
                ? `${arrow} $${Math.abs(quote.change).toFixed(2)}`
                : `${arrow} ${Math.abs(quote.change).toLocaleString("ko-KR")}`
              : null;
            const href = `/stock/${encodeURIComponent(item.code)}`;
            const discussHref = `/discussion-explorer?code=${encodeURIComponent(item.code)}&name=${encodeURIComponent(item.name)}&market=${isUs ? "US" : "KR"}`;
            const displayName = names[idx] ?? item.name;

            return (
              <div
                key={item.code}
                className={`recent-dock-card-wrap ${compact ? "recent-dock-card-wrap--compact" : ""}`}
                style={{ animationDelay: `${idx * 45}ms` }}
              >
                <Link
                  to={href}
                  className={`recent-dock-card ${compact ? "recent-dock-card--compact" : ""} ${flash ? `is-flash-${flash}` : ""}`}
                  title={`${item.name} (${item.code})`}
                >
                  {compact ? (
                    <>
                      <span className="recent-dock-card-top">
                        <StockLogo code={item.code} className="recent-dock-card-logo recent-dock-card-logo--compact" />
                        <span className="recent-dock-card-name recent-dock-card-name--compact">{displayName}</span>
                      </span>
                      {quote ? (
                        <>
                          <strong className="recent-dock-card-price--compact">{priceText}</strong>
                          <em className={`recent-dock-card-change--compact ${changeClass}`}>{pctText}</em>
                        </>
                      ) : (
                        <span className="recent-dock-card-skeleton recent-dock-card-skeleton--compact" aria-hidden="true" />
                      )}
                    </>
                  ) : (
                    <>
                      <StockLogo code={item.code} className="recent-dock-card-logo" />
                      <span className="recent-dock-card-info">
                        <span className="recent-dock-card-name">{displayName}</span>
                        <span className="recent-dock-card-code">{item.code}</span>
                      </span>
                      <span className="recent-dock-card-price-line">
                        {quote && (
                          <span className={`recent-dock-card-change-amount ${changeClass}`}>{changeAmountText}</span>
                        )}
                        <span className="recent-dock-card-price">
                          {quote ? (
                            <>
                              <strong>{priceText}</strong>
                              <em className={changeClass}>{pctText}</em>
                            </>
                          ) : (
                            <span className="recent-dock-card-skeleton" aria-hidden="true" />
                          )}
                        </span>
                      </span>
                    </>
                  )}
                </Link>
                <button
                  type="button"
                  className="recent-dock-card-discuss"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    navigate(discussHref);
                  }}
                  title={t("종목토론")}
                  aria-label={`${item.name} ${t("종목토론")}`}
                >
                  <DiscussionIcon />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
