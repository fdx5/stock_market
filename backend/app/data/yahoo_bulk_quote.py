"""Extended-hours-aware quotes for hundreds of US tickers in a handful of requests.

`yahoo_quote` already reads pre/post prints, but off the v8 chart endpoint, which takes
one symbol per request. That is affordable for the ticker belt's two dozen entries and
for a single detail page; it is not affordable for the S&P 500's 503 constituents on a
15-second refresh. Which is why the US maps and the NASDAQ TOP 100 board ran on
slickcharts' regular-hours table alone and froze at the closing bell — a Seoul visitor
opening them at 23:00 KST was looking at prices that had already moved, with nothing on
screen saying so.

Yahoo's v7 quote endpoint takes 200 symbols per request (the whole S&P is three calls,
about a second) and reports the pre/post print as its own field rather than making the
caller walk an intraday series. The price of that is a crumb: it answers 401 without
one, so this module holds a cookie+crumb pair and re-acquires it when a request comes
back unauthorized.

Nothing here raises. Every caller overlays these quotes onto a roster it already has, so
a failed batch must cost those names their live print — never the page.
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
}

QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote"
CRUMB_URL = "https://query1.finance.yahoo.com/v1/test/getcrumb"
# Answers 404, but sets the consent cookie the crumb is issued against — the status is
# deliberately not checked.
COOKIE_URL = "https://fc.yahoo.com"

# 200 covers the S&P 500 in three requests and keeps the comma-joined query string well
# inside any URL length limit. Yahoo accepts more, but an oversized batch that gets
# rejected costs every symbol in it, so this stays at a size verified to work.
CHUNK_SIZE = 200
TIMEOUT_SECONDS = 8

# After a failed crumb handshake, don't attempt another for this long. Without it a
# blocked upstream would make every chunk of every refresh pay two connection timeouts
# in series, under the lock — turning a degraded feed into a stalled one.
AUTH_RETRY_COOLDOWN_SECONDS = 60

_auth_lock = threading.Lock()
_auth: tuple[requests.Session, str] | None = None
_auth_blocked_until = 0.0


def _new_auth() -> tuple[requests.Session, str]:
    session = requests.Session()
    session.headers.update(HEADERS)
    try:
        session.get(COOKIE_URL, timeout=TIMEOUT_SECONDS)
    except requests.RequestException:
        # The cookie call failing outright is survivable often enough to be worth
        # trying the crumb anyway; the crumb call below is the one that must succeed.
        pass
    resp = session.get(CRUMB_URL, timeout=TIMEOUT_SECONDS)
    resp.raise_for_status()
    crumb = resp.text.strip()
    # A crumb is a short opaque token. Anything containing markup is an error/consent
    # page served with a 200, which would otherwise be sent as a crumb on every request.
    if not crumb or "<" in crumb or len(crumb) > 64:
        raise ValueError(f"unexpected crumb response: {crumb[:40]!r}")
    return session, crumb


def _get_auth(refresh: bool = False) -> tuple[requests.Session, str]:
    """The shared cookie+crumb pair, acquired at most once per cooldown across all
    threads — concurrent chunks of the same refresh must not each run their own
    handshake."""
    global _auth, _auth_blocked_until
    with _auth_lock:
        if not refresh and _auth is not None:
            return _auth
        if time.time() < _auth_blocked_until:
            raise RuntimeError("yahoo crumb handshake is cooling down after a failure")
        try:
            _auth = _new_auth()
        except Exception:
            _auth_blocked_until = time.time() + AUTH_RETRY_COOLDOWN_SECONDS
            raise
        return _auth


def _yahoo_symbol(symbol: str) -> str:
    """Class-share tickers are written with a dot by slickcharts (BRK.B) and with a
    hyphen by Yahoo (BRK-B). Two names on the S&P, but they are Berkshire and Brown-
    Forman — leaving them unquoted would be visible."""
    return symbol.replace(".", "-")


def _pct(now: float, base: float) -> float | None:
    return (now / base - 1) * 100 if base else None


def _previous_close(row: dict, regular_close: float) -> float:
    value = row.get("regularMarketPreviousClose")
    if value is not None:
        return float(value)
    change = row.get("regularMarketChange")
    return regular_close - float(change) if change is not None else regular_close


# PREPRE is the 00:00-04:00 ET gap before pre-market opens; it is grouped with PRE so a
# quote struck in it is read the same way. POST/POSTPOST/CLOSED all fall through to the
# post branch, which is what keeps an evening earnings move on screen overnight and
# through a weekend instead of the page reverting to the 16:00 close.
_PRE_STATES = {"PRE", "PREPRE"}


def _read(row: dict) -> dict | None:
    """One quote row, reduced to the fields every US surface on this site draws.

    The baseline each change is measured against differs by session, and picking the
    wrong one is the easy mistake here:

    - Pre-market quotes against the last regular close, which is exactly what
      `regularMarketPrice` holds during that session — today's regular session hasn't
      run, so there is no regular leg to add. `regularMarketPreviousClose` has not
      rolled forward yet at that hour (it still names the close before the last one),
      and using it would fold all of yesterday's session into a pre-market change.
    - Post-market quotes against `regularMarketPreviousClose`, so `change_pct` is the
      day's regular move *plus* the after-hours move — where the name stands versus
      yesterday, which is the question after the bell. The two legs are also carried
      apart (`regular_change_pct` / `extended_change_pct`) so a card can show both.
    """
    regular_close = row.get("regularMarketPrice")
    if regular_close is None:
        return None
    regular_close = float(regular_close)

    state = row.get("marketState") or "REGULAR"
    pre_price = row.get("preMarketPrice")
    post_price = row.get("postMarketPrice")

    if state in _PRE_STATES and pre_price is not None:
        price, session = float(pre_price), "pre"
        previous_close, regular_change_pct = regular_close, None
    elif state != "REGULAR" and post_price is not None:
        price, session = float(post_price), "post"
        previous_close = _previous_close(row, regular_close)
        regular_change_pct = _pct(regular_close, previous_close)
    else:
        price, session = regular_close, "regular"
        previous_close = _previous_close(row, regular_close)
        regular_change_pct = _pct(regular_close, previous_close)

    return {
        "close": round(price, 4),
        "change": round(price - previous_close, 4),
        "change_pct": round(_pct(price, previous_close) or 0.0, 2),
        "session": session,
        # The regular session's own close and move, so a surface showing an extended
        # price can still say what the stock did while the exchange was open. Null
        # `regular_change_pct` means "that session hasn't happened yet" (pre-market),
        # which is a different statement from 0.00%.
        "regular_close": round(regular_close, 4),
        "regular_change_pct": None if regular_change_pct is None else round(regular_change_pct, 2),
        # The extended leg alone, versus the regular close. Null during regular hours.
        "extended_change_pct": None if session == "regular" else round(_pct(price, regular_close) or 0.0, 2),
    }


def _fetch_chunk(symbols: list[str], retry: bool = True) -> dict[str, dict]:
    session, crumb = _get_auth()
    resp = session.get(
        QUOTE_URL, params={"symbols": ",".join(symbols), "crumb": crumb}, timeout=TIMEOUT_SECONDS
    )
    if resp.status_code in (401, 403) and retry:
        # A crumb expires with its cookie. One re-acquisition, then give up: a genuinely
        # blocked upstream must not turn into a retry loop per chunk per refresh.
        _get_auth(refresh=True)
        return _fetch_chunk(symbols, retry=False)
    resp.raise_for_status()

    quotes: dict[str, dict] = {}
    for row in resp.json().get("quoteResponse", {}).get("result") or []:
        quote = _read(row)
        if quote and row.get("symbol"):
            quotes[row["symbol"]] = quote
    return quotes


def get_quotes(symbols: list[str]) -> dict[str, dict]:
    """Extended-hours-aware quotes keyed by the *caller's* spelling of each symbol.

    Symbols Yahoo doesn't answer for are simply absent, as is everything in a chunk
    whose request failed — callers overlay this onto a roster they already hold, so the
    right failure mode is one name showing its delayed snapshot, not a broken page.
    """
    by_yahoo: dict[str, str] = {}
    for symbol in symbols:
        if symbol:
            by_yahoo.setdefault(_yahoo_symbol(symbol), symbol)
    if not by_yahoo:
        return {}

    requested = list(by_yahoo)
    chunks = [requested[i : i + CHUNK_SIZE] for i in range(0, len(requested), CHUNK_SIZE)]

    quotes: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=min(4, len(chunks))) as pool:
        futures = [pool.submit(_fetch_chunk, chunk) for chunk in chunks]
        for future in as_completed(futures):
            try:
                result = future.result()
            except Exception:  # noqa: BLE001 - a failed chunk costs its symbols, nothing else
                continue
            for yahoo_symbol, quote in result.items():
                original = by_yahoo.get(yahoo_symbol)
                if original:
                    quotes[original] = quote
    return quotes
