"""Crumb+cookie auth for the Yahoo Finance endpoints that require it: v10
quoteSummary (fundamentals), v7 quote (batch quotes) and the extended-hours bulk
quotes. The v8 chart endpoint the rest of this app uses (sparkline_fetcher,
global_marketcap_fetcher) needs neither and is untouched by this module.

Yahoo stopped answering those unauthenticated sometime in 2024 ("Invalid Crumb",
HTTP 401) but still issues a valid crumb to an unauthenticated session that first
picks up a cookie from fc.yahoo.com — this is that handshake, done once and reused
until a caller reports the crumb no longer works.

────────────────────────────────────────────────────────────────────────────────
Why this file is mostly rate-limiting rather than handshaking.

getcrumb answers 429 when it is asked too often, and everything about the naive
version of this module turned one 429 into a great many:

  - A failed handshake set no cooldown, so the next caller tried again at once,
    and the one after that. A single throttle became a tight loop against the
    endpoint that was throttling us.

  - force_refresh had no floor. The fundamentals fetcher walks ~100 symbols in
    sequence and refreshes on any 401; when the crumb genuinely died, all 100
    asked for a new one, and Yahoo saw a hundred handshakes in thirty-five
    seconds. Ninety-nine of them were asking for a crumb that the first had
    already fetched.

  - There were two of these modules. yahoo_bulk_quote kept its own cookie jar
    and its own crumb, so every refresh cost two handshakes and neither pool
    knew the other was being throttled.

So: one pool, one in-flight handshake at a time, a floor under how often a
refresh may actually happen, and a cooldown after a failure that doubles while
the failures continue. A 429 is not an auth problem and re-handshaking cannot
fix it — when Yahoo sends one, the only useful response is to wait, and for as
long as it asks.
"""

import logging
import random
import threading
import time

import requests

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
}

_COOKIE_URL = "https://fc.yahoo.com"
_CRUMB_URL = "https://query2.finance.yahoo.com/v1/test/getcrumb"

_TIMEOUT_SECONDS = 8

# How recently a crumb may have been fetched for a force_refresh to be ignored.
#
# This is the single most useful number here. A refresh is requested by a caller
# that just saw a 401 — but a batch of a hundred symbols produces a hundred of
# those, from one dead crumb, within a few seconds of each other. The first
# request replaces it; every other one is asking for something it already has.
# Thirty seconds is far longer than any batch takes to notice, and far shorter
# than a crumb's real lifetime.
_REFRESH_MIN_AGE_SECONDS = 30.0

# After a failed handshake, how long before another is attempted — doubling with
# each consecutive failure so a persistent block is not probed at a fixed rate.
_COOLDOWN_BASE_SECONDS = 60.0
_COOLDOWN_MAX_SECONDS = 900.0

_lock = threading.Lock()
_session: requests.Session | None = None
_crumb: str | None = None
_crumb_at = 0.0
_blocked_until = 0.0
_failures = 0


class CrumbUnavailable(RuntimeError):
    """No crumb, and it is not worth asking for one yet. Callers treat this the
    same as any other fetch failure — the point is that it costs no request."""


def _retry_after_seconds(resp: requests.Response) -> float | None:
    """What Yahoo asked us to wait, if it said. Only the numeric form is read;
    the HTTP-date form is legal but Yahoo does not use it, and guessing at a
    parse failure is worse than falling back to our own backoff."""
    raw = resp.headers.get("Retry-After")
    if not raw:
        return None
    try:
        return max(0.0, float(raw.strip()))
    except ValueError:
        return None


def _new_session_and_crumb() -> tuple[requests.Session, str]:
    session = requests.Session()
    session.headers.update(HEADERS)
    # fc.yahoo.com answers 404 by design (it's a cookie-setting redirect target, not a
    # real page) — only the Set-Cookie header on the response matters here.
    try:
        session.get(_COOKIE_URL, timeout=_TIMEOUT_SECONDS)
    except requests.RequestException:
        pass

    resp = session.get(_CRUMB_URL, timeout=_TIMEOUT_SECONDS)
    if resp.status_code == 429:
        # Raised as its own type so the caller below can take Yahoo's own figure
        # for the cooldown instead of our guess at one.
        raise _Throttled(_retry_after_seconds(resp))
    resp.raise_for_status()

    crumb = resp.text.strip()
    # A crumb is a short opaque token. Anything containing markup is an error or
    # consent page served with a 200, which would otherwise be sent as a crumb on
    # every subsequent request and fail all of them.
    if not crumb or "<" in crumb or len(crumb) > 64:
        raise ValueError(f"unexpected crumb response: {crumb[:40]!r}")
    return session, crumb


class _Throttled(RuntimeError):
    def __init__(self, retry_after: float | None):
        super().__init__("getcrumb answered 429")
        self.retry_after = retry_after


def get_crumb(force_refresh: bool = False) -> tuple[requests.Session, str]:
    """A (session, crumb) pair to use as `session.get(url, params={..., "crumb": crumb})`.

    Shared across every caller in the process. Pass force_refresh=True after a
    call comes back 401 — but note that it is a request, not an instruction: if
    the crumb in hand is newer than _REFRESH_MIN_AGE_SECONDS somebody else has
    already replaced it, and yours is the one they fetched.

    Raises CrumbUnavailable while cooling down after a failure. That is a
    deliberate part of the contract: the alternative is spending a connection
    timeout, or a 429, to learn what is already known.
    """
    global _session, _crumb, _crumb_at, _blocked_until, _failures

    with _lock:
        have = _session is not None and _crumb is not None
        fresh = time.time() - _crumb_at < _REFRESH_MIN_AGE_SECONDS
        if have and (not force_refresh or fresh):
            return _session, _crumb  # type: ignore[return-value]

        now = time.time()
        if now < _blocked_until:
            raise CrumbUnavailable(
                f"getcrumb cooling down for another {_blocked_until - now:.0f}s"
            )

        try:
            _session, _crumb = _new_session_and_crumb()
        except Exception as exc:
            _failures += 1
            wait = min(_COOLDOWN_BASE_SECONDS * 2 ** (_failures - 1), _COOLDOWN_MAX_SECONDS)
            if isinstance(exc, _Throttled) and exc.retry_after is not None:
                # Yahoo's own number wins, and is never undercut by ours.
                wait = max(wait, exc.retry_after)
            # Jitter, so several workers that were throttled together do not come
            # back together and throttle each other again.
            _blocked_until = time.time() + wait * random.uniform(0.85, 1.15)
            logger.warning(
                "yahoo_session: crumb handshake failed (%s), backing off %.0fs",
                type(exc).__name__,
                wait,
            )
            raise
        _crumb_at = time.time()
        _failures = 0
        return _session, _crumb
