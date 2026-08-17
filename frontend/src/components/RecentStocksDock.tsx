import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link, useRoute } from "../router";
import { useWatchlist } from "../useWatchlist";
import StockLogo from "./StockLogo";
import "./recentStocksDock.css";

const MAX_ITEMS = 5;
const POLL_MS = 5_000;
const COLLAPSE_KEY = "kstock_recent_dock_collapsed";

// Footprint the dock needs in the gutter past the page's own content column
// before it's worth showing at all. Below this the page's own max-width
// container already reaches close enough to the browser edge that the dock
// would have to either clip or sit on top of the content it's meant to stand
// beside — so instead it just doesn't render, on any screen that tight
// (which naturally includes every phone and tablet, with no separate mobile
// check needed).
const DOCK_WIDTH = 196;
const GAP_FROM_CONTENT = 20;
const GAP_FROM_EDGE = 16;
const MIN_GUTTER = DOCK_WIDTH + GAP_FROM_CONTENT + GAP_FROM_EDGE;

interface DockPos {
  left: number;
  top: number;
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
 * measurement doubles as the "is there actually room" check, so the dock
 * quietly renders nothing on a desktop viewport too narrow to fit it without
 * overlapping the content it's meant to sit beside.
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
    const measure = () => {
      const app = document.querySelector<HTMLElement>(".app");
      if (!app) {
        setDock(null);
        return;
      }
      const rect = app.getBoundingClientRect();
      const gutter = window.innerWidth - rect.right;
      if (gutter < MIN_GUTTER) {
        setDock(null);
        return;
      }
      const header = document.querySelector<HTMLElement>(".app-header");
      const headerH = header ? header.getBoundingClientRect().height : 72;
      setDock({ left: rect.right + GAP_FROM_CONTENT, top: Math.max(24, headerH + 24) });
    };

    measure();
    const settleId = window.setTimeout(measure, 300);
    window.addEventListener("resize", measure);

    const app = document.querySelector(".app");
    const ro = app ? new ResizeObserver(measure) : null;
    if (app && ro) ro.observe(app);

    return () => {
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

  return (
    <aside className="recent-dock" style={{ left: dock.left, top: dock.top }} aria-label={t("최근 본 종목")}>
      <button type="button" className="recent-dock-head" onClick={toggleCollapsed} aria-expanded={!collapsed}>
        <span className="recent-dock-head-icon" aria-hidden="true">🕘</span>
        <span className="recent-dock-head-label">{t("최근 본 종목")}</span>
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
            const href = isUs
              ? `/global?code=${encodeURIComponent(item.code)}&name=${encodeURIComponent(item.name)}`
              : `/desk?code=${encodeURIComponent(item.code)}&name=${encodeURIComponent(item.name)}`;
            return (
              <Link
                key={item.code}
                to={href}
                className={`recent-dock-card ${flash ? `is-flash-${flash}` : ""}`}
                style={{ animationDelay: `${idx * 45}ms` }}
                title={`${item.name} (${item.code})`}
              >
                <StockLogo code={item.code} className="recent-dock-card-logo" />
                <span className="recent-dock-card-info">
                  <span className="recent-dock-card-name">{names[idx] ?? item.name}</span>
                  <span className="recent-dock-card-code">{item.code}</span>
                </span>
                <span className="recent-dock-card-price">
                  {quote ? (
                    <>
                      <strong>
                        {isUs
                          ? `$${quote.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : quote.close.toLocaleString("ko-KR")}
                      </strong>
                      <em className={up ? "is-up" : down ? "is-down" : "is-flat"}>
                        {up ? "▲" : down ? "▼" : "•"} {Math.abs(quote.change_pct).toFixed(2)}%
                      </em>
                    </>
                  ) : (
                    <span className="recent-dock-card-skeleton" aria-hidden="true" />
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </aside>
  );
}
