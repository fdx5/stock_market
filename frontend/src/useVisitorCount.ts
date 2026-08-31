import { useEffect, useState } from "react";
import { getSessionId } from "./session";

const HEARTBEAT_MS = 20_000;

export interface VisitorCounts {
  /** Browsers with an active heartbeat in the last minute, site-wide. */
  current: number | null;
  /** Cumulative count of distinct visitor sessions ever recorded. */
  total: number | null;
}

export function useVisitorCount(enabled = true): VisitorCounts {
  const [counts, setCounts] = useState<VisitorCounts>({ current: null, total: null });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const sessionId = getSessionId();

    const ping = () => {
      fetch(`/api/visitors/count?session_id=${encodeURIComponent(sessionId)}&heartbeat_v=2&t=${Date.now()}`, {
        // A heartbeat must reach the origin every time. The custom domain may sit
        // behind a browser/CDN cache, and a cached 200 silently expires this session.
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      })
        .then((res) => res.json())
        .then((data: { count: number; total: number }) => {
          if (!cancelled) setCounts({ current: data.count, total: data.total });
        })
        .catch(() => {
          // A missed heartbeat isn't worth surfacing as an error — just keep the last counts.
        });
    };

    ping();
    // Presence means the site remains open, including a background tab. Using the
    // generic visibility-aware poller here cut the displayed audience to only the
    // foreground tabs. Browsers may throttle this interval in the background; the
    // server TTL deliberately allows several scheduled ticks.
    const interval = window.setInterval(ping, HEARTBEAT_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled]);

  return counts;
}
