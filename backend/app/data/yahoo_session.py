"""Crumb+cookie auth for the two Yahoo Finance endpoints that now require it:
v10/finance/quoteSummary (fundamentals) and v7/finance/quote (batch live quotes).
The v8 chart endpoint the rest of this app already uses (sparkline_fetcher,
global_marketcap_fetcher) needs neither and is untouched by this module.

Yahoo stopped answering these two unauthenticated sometime in 2024 ("Invalid Crumb",
HTTP 401) but still issues a valid crumb to an unauthenticated session that first
picks up a cookie from fc.yahoo.com — this is that handshake, done once and reused
until a caller reports the crumb no longer works.
"""

import threading

import requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
}

_COOKIE_URL = "https://fc.yahoo.com"
_CRUMB_URL = "https://query2.finance.yahoo.com/v1/test/getcrumb"

_lock = threading.Lock()
_session: requests.Session | None = None
_crumb: str | None = None


def _new_session_and_crumb() -> tuple[requests.Session, str]:
    session = requests.Session()
    session.headers.update(HEADERS)
    # fc.yahoo.com answers 404 by design (it's a cookie-setting redirect target, not a
    # real page) — only the Set-Cookie header on the response matters here.
    try:
        session.get(_COOKIE_URL, timeout=6)
    except requests.RequestException:
        pass
    resp = session.get(_CRUMB_URL, timeout=6)
    resp.raise_for_status()
    crumb = resp.text.strip()
    if not crumb:
        raise RuntimeError("Yahoo returned an empty crumb")
    return session, crumb


def get_crumb(force_refresh: bool = False) -> tuple[requests.Session, str]:
    """A (session, crumb) pair to use as `session.get(url, params={..., "crumb": crumb})`.
    Cached at module level and shared across all callers; pass force_refresh=True after
    a call comes back 401 to get a fresh cookie+crumb rather than repeating the same
    now-dead one."""
    global _session, _crumb
    with _lock:
        if force_refresh or _session is None or _crumb is None:
            _session, _crumb = _new_session_and_crumb()
        return _session, _crumb
