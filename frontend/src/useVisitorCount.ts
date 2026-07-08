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

/** Site-wide count of browsers with an active heartbeat in the last minute. */
export function useVisitorCount(): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const sessionId = getSessionId();

    const ping = () => {
      fetch(`/api/visitors/count?session_id=${encodeURIComponent(sessionId)}`)
        .then((res) => res.json())
        .then((data: { count: number }) => {
          if (!cancelled) setCount(data.count);
        })
        .catch(() => {
          // A missed heartbeat isn't worth surfacing as an error — just keep the last count.
        });
    };

    ping();
    const interval = setInterval(ping, HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return count;
}
