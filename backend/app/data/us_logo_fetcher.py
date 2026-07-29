"""US company logo bytes, re-served from this app's own origin.

The map pages and the NASDAQ board load these logos straight from companiesmarketcap in
the browser, which costs this app nothing and is where they should keep coming from.
This module exists for exactly one caller: the maps' "MAP 다운로드" button, which redraws
the treemap onto a canvas and then calls `toBlob()` on it.

That host sends no `Access-Control-Allow-Origin` at all — not even in response to a
preflight — and an image fetched from such an origin taints the canvas it is drawn into.
A tainted canvas makes `toBlob()` throw SecurityError, so including the logos the direct
way wouldn't just skip them, it would break the download outright. Bytes served from our
own origin don't taint, so the export asks for them here.

That keeps this off the page-view path and on an explicit, occasional click: roughly the
40 tiles per map large enough to show an icon, about 100KB a click, against a bandwidth
budget the rest of this app works to protect. Logos are cached in-process afterwards, so
repeat exports of the same map cost the upstream nothing.
"""

import re

import requests

from app.services.cache import cache

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
}

# Kept in sync by hand with frontend/src/usLogo.ts, which builds the on-screen URL. The
# size has to match: the export is meant to reproduce what the map displays, and this
# host serves a different asset at 64px for some companies (see that file's note).
LOGO_URL = "https://companiesmarketcap.com/img/company-logos/128/{symbol}.webp"

# A logo never changes, so the only thing this TTL bounds is how long a *failure* sticks
# around before we retry the upstream.
TTL_LOGO_SECONDS = 24 * 3600

TIMEOUT_SECONDS = 6

# The one thing standing between a path parameter and an outbound request, so it is a
# strict allowlist rather than a blocklist: an uppercase ticker, optionally hyphenated
# for a share class (BRK-B). No dots, no slashes, no percent-escapes — nothing that
# could climb out of the logo directory or point the fetch at another host entirely.
# Aliasing and the dot-to-hyphen rewrite happen client-side (frontend/src/usLogo.ts);
# by the time a ticker arrives here it is already in the host's own spelling.
_TICKER_RE = re.compile(r"^[A-Z][A-Z0-9]{0,6}(-[A-Z])?$")


def _fetch(symbol: str) -> tuple[bytes, str] | None:
    try:
        resp = requests.get(LOGO_URL.format(symbol=symbol), headers=HEADERS, timeout=TIMEOUT_SECONDS)
    except requests.RequestException:
        return None
    content_type = resp.headers.get("content-type", "")
    # This host answers a missing logo with a 200 HTML error page, so the status alone
    # doesn't say whether we got an image.
    if resp.status_code != 200 or not content_type.startswith("image/"):
        return None
    return resp.content, content_type


def get_us_logo(ticker: str) -> tuple[bytes, str] | None:
    """(bytes, content-type) for one ticker's logo, or None for a ticker this host has no
    logo for — or one whose shape says it was never a ticker at all.

    A None is cached like any other answer: a miss is a real, stable fact about a handful
    of names (Ferrovial is one), and re-asking the upstream on every export click would
    make the tickers with no logo the most expensive ones on the map.
    """
    symbol = (ticker or "").strip().upper()
    if not _TICKER_RE.match(symbol):
        return None
    return cache.get_or_set(f"us_logo:{symbol}", TTL_LOGO_SECONDS, lambda: _fetch(symbol))
