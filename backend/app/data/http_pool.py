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
from requests.adapters import HTTPAdapter

# Connections kept per host; past the busiest moment the site reaches one host with.
POOL_MAXSIZE = 64
# Hosts a session keeps a pool for.
POOL_CONNECTIONS = 10


def mount_pool(session: requests.Session) -> requests.Session:
    """Mounts the shared pool size on a session (https and http), with one retry."""
    adapter = HTTPAdapter(pool_connections=POOL_CONNECTIONS, pool_maxsize=POOL_MAXSIZE, max_retries=1)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session
