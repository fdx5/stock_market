import { useEffect, useState } from "react";

const SESSION_KEY = "visitor_session_id";
const HEARTBEAT_MS = 20_000;

function getSessionId(): string {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export interface VisitorCounts {
  /** Browsers with an active heartbeat in the last minute, site-wide. */
  current: number | null;
  /** Cumulative count of distinct visitor sessions ever recorded. */
  total: number | null;
}

export function useVisitorCount(): VisitorCounts {
  const [counts, setCounts] = useState<VisitorCounts>({ current: null, total: null });

  useEffect(() => {
    let cancelled = false;
    const sessionId = getSessionId();

    const ping = () => {
      fetch(`/api/visitors/count?session_id=${encodeURIComponent(sessionId)}`)
        .then((res) => res.json())
        .then((data: { count: number; total: number }) => {
          if (!cancelled) setCounts({ current: data.count, total: data.total });
        })
        .catch(() => {
          // A missed heartbeat isn't worth surfacing as an error — just keep the last counts.
        });
    };

    ping();
    const interval = setInterval(ping, HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return counts;
}
