import { useEffect, useState } from "react";
import { getSessionId } from "./session";
import { startVisibilityAwareInterval } from "./pollVisibility";

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
      fetch(`/api/visitors/count?session_id=${encodeURIComponent(sessionId)}`, {
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
    const stopHeartbeat = startVisibilityAwareInterval(ping, HEARTBEAT_MS);

    return () => {
      cancelled = true;
      stopHeartbeat();
    };
  }, [enabled]);

  return counts;
}
