"""The connection pool the shared scraping sessions mount.

Each shared session (Naver's market-cap pages, discussion boards, order book, Toss)
is used by many threads at once: a market map fetches its pages eight at a time, for
KOSPI and KOSDAQ together, while visitors' requests and the startup warm-up reach
the same host. With a pool of 20 per host the overflow opened a fresh connection
for each extra request and threw it away afterwards — "Connection pool is full,
discarding connection: m.stock.naver.com" — paying a new TLS handshake every time and
looking to the host like a burst of new clients. The pool is sized past that peak.
"""

import requests
import math
import time
from email.utils import parsedate_to_datetime
from requests.adapters import HTTPAdapter

# Connections kept per host; past the busiest moment the site reaches one host with.
POOL_MAXSIZE = 64
# Hosts a session keeps a pool for.
POOL_CONNECTIONS = 10


def retry_after_seconds(resp: requests.Response) -> float | None:
    """Retry-After in seconds or HTTP-date form; ignore invalid/nonfinite values."""
    raw = resp.headers.get("Retry-After")
    if not raw:
        return None
    try:
        value = float(raw.strip())
    except ValueError:
        try:
            value = parsedate_to_datetime(raw).timestamp() - time.time()
        except (TypeError, ValueError, OverflowError):
            return None
    return max(0.0, value) if math.isfinite(value) else None


def mount_pool(session: requests.Session, *, max_retries: int = 1) -> requests.Session:
    """Mounts the shared pool; callers with their own recovery can disable retries."""
    adapter = HTTPAdapter(pool_connections=POOL_CONNECTIONS, pool_maxsize=POOL_MAXSIZE, max_retries=max_retries)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session
