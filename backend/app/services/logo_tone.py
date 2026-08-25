"""Which company logos are too dark to read on a dark page.

Apple's mark is a black silhouette on a transparent background. On the light theme it
is the logo; on the dark theme it is a black shape on a near-black row, which is to say
nothing at all. Enough listed companies use a black or near-black wordmark that this is
a category, not a special case.

**Why this is measured rather than styled around.** The obvious fix — put a light plate
behind every logo in dark mode — is wrong here, because Naver's KR logos are circles
with transparent corners: a square plate behind one shows as a white card with a
coloured disc floating on it, and that is worse for the 490 logos that were fine than
the problem it fixes for the 10 that were not. Only the dark ones may be touched, so
the dark ones have to be identified.

**Why on the server.** Reading a pixel needs the image, and the logo hosts send no
CORS header (see usLogo.ts's note on the same problem for the map export), so a browser
canvas holding one of these is tainted and `getImageData` throws. The server has no
such restriction.

**What is measured.** Two things, because one is not enough.

*How much of the mark is dark ink.* The share of visible pixels below DARK_INK. Not the
mean luminance and not the brightest pixel: Amazon's wordmark is black lettering with a
small orange smile under it, so its mean is 0.13 (dark, correctly) but its brightest
part is 0.53 (light, misleadingly) — the accent lifts the maximum while the lettering
that carries the name stays invisible. Caterpillar's black CAT with a yellow triangle is
the same shape of problem.

*Whether the mark fills its own tile.* The share of the image that is opaque at all. This
is what separates "dark ink floating on transparency", which disappears into the page,
from "a dark badge with something bright on it", which does not — a filled disc is its
own background and reads at any tint. It is also the single clean line between the two
logo hosts: every Naver logo is a disc covering 0.80 of its tile, and no US mark that
needs help covers more than 0.56.

    plate needed     AAPL 1.00/0.56   CAT 0.80/0.44   AMZN 0.75/0.32   V 1.00/0.20
    filled badge     KO 0.84/0.80   COST 0.63/0.72   MSFT 0.00/0.92
    light mark       NVDA 0.00/0.42   WMT 0.00/0.30   MA 0.43/0.53
    every KR logo    0.87-0.94 / 0.80  (dark disc, white lettering, fills the tile)

Read as dark-share / coverage. A logo is plated only when both say so, which is why the
KR rosters come back entirely unplated despite being darker on average than Visa.

Results are cached for a week: a company's logo does not change, and the cost of being
wrong for a week after a rebrand is a slightly-wrong plate.
"""

from __future__ import annotations

import io
import logging
import threading

import requests
from PIL import Image

from app.data.us_logo_fetcher import get_us_logo
from app.services.cache import cache

log = logging.getLogger(__name__)

# A pixel this dark is ink that will not read against the dark theme's #1a1a19 surface.
#
# Not a taste call: 0.40 is where a grey stops clearing WCAG's 3:1 minimum contrast for
# graphical objects against that surface (whose relative luminance is 0.0103), so it is
# the line between "dim but legible" and "not legible". What that classifies, in
# contrast terms:
#
#     black          0.83:1     Visa navy      1.57:1     Netflix red   2.04:1
#     Chevron blue   2.60:1     Meta blue      2.81:1     Amazon smile  4.86:1
#
# Everything at or under 2.81 is below the minimum; the accent that lifts Amazon's
# wordmark is comfortably over it, which is exactly why the *share* of dark ink is what
# gets thresholded rather than the brightest pixel.
DARK_INK = 0.40

# How much of the mark has to be that dark before it needs help. In the gap between
# META (0.48, a blue mark that reads) and AMZN (0.75, black lettering that does not).
DARK_SHARE_THRESHOLD = 0.6

# Above this share of opaque pixels the logo is a filled badge carrying its own
# background, so it reads whatever its tint. Sits in the gap between the darkest US mark
# that needs a plate (AAPL, 0.56) and the filled ones that do not (COST 0.72, every
# Naver disc 0.80).
COVERAGE_THRESHOLD = 0.7

# Below this alpha a pixel is padding, not artwork.
MIN_ALPHA = 40

# A logo never changes; this bounds how long a *failed* probe sticks around.
TTL_SECONDS = 7 * 24 * 3600

# Naver's KR logo host, the same URL stockIcon.ts builds on the client.
KR_LOGO_URL = "https://ssl.pstatic.net/imgstock/fn/real/logo/png/stock/Stock{code}.png"

# The logo host's own spelling of a ticker, mirroring logoSymbol() in usLogo.ts. This
# has to agree with the client exactly: it decides which image the browser shows, and
# measuring a *different* image than the one on screen is worse than measuring none —
# it produces a confident verdict about the wrong logo.
#
# Without it the probe simply found nothing for these, so BRK.B and the class-A tickers
# were silently never evaluated. Kept small and hand-synced for the same reason
# us_logo_fetcher's LOGO_URL is: the pair is two lines, and a shared endpoint for it
# would be a round trip to answer a string rewrite.
_TICKER_ALIASES = {
    "GOOGL": "GOOG",   # Alphabet class A -> class C
    "FOXA": "FOX",     # Fox class A -> class B
    "NWSA": "NWS",     # News Corp class A -> class B
    "BF.B": "BF-A",    # Brown-Forman class B -> class A
    "BNY": "BK",       # Bank of New York Mellon, still filed under its former ticker
}

# Served by this app, not the logo host — see SELF_HOSTED_LOGOS in usLogo.ts. Nothing to
# probe: the file is ours and is a colour mark, so it never needs a plate.
_SELF_HOSTED = {"SKHY"}


def _logo_symbol(ticker: str) -> str:
    return _TICKER_ALIASES.get(ticker, ticker).replace(".", "-")

REQUEST_TIMEOUT = 5

# Sampling ceiling. These images are 40-100px square, so this is not a downscale in
# practice — it is a guard against a host one day serving something enormous.
MAX_EDGE = 96


def measure(payload: bytes) -> tuple[float, float] | None:
    """(dark share, coverage) for one logo, or None if the image is unreadable.

    Both are over the pixels opaque enough to be seen — transparent padding is the page
    showing through, not artwork.
    """
    try:
        image = Image.open(io.BytesIO(payload))
        image.thumbnail((MAX_EDGE, MAX_EDGE))
        image = image.convert("RGBA")
    except Exception:
        return None

    total = image.width * image.height
    visible = 0
    dark = 0
    for r, g, b, a in image.getdata():
        if a < MIN_ALPHA:
            continue
        visible += 1
        # Rec. 601 luma — "how bright does this look" to an eye, rather than the mean of
        # the channels, which would call pure blue a mid-grey.
        if (0.299 * r + 0.587 * g + 0.114 * b) / 255.0 < DARK_INK:
            dark += 1

    if visible < 16 or not total:
        # Essentially empty: a blank or fully transparent image tells us nothing, and
        # calling it dark would put a plate behind nothing.
        return None
    return dark / visible, visible / total


def needs_plate(payload: bytes) -> bool:
    """Whether this logo is dark ink floating on transparency."""
    measured = measure(payload)
    if measured is None:
        return False
    dark_share, coverage = measured
    return dark_share >= DARK_SHARE_THRESHOLD and coverage < COVERAGE_THRESHOLD


def _fetch_kr(code: str) -> bytes | None:
    try:
        response = requests.get(KR_LOGO_URL.format(code=code), timeout=REQUEST_TIMEOUT)
        if response.status_code != 200 or not response.content:
            return None
        return response.content
    except Exception:
        return None


def _probe(code: str) -> bool:
    """True when this code's logo needs a light plate behind it on the dark theme."""
    is_kr = len(code) == 6 and code.isdigit()
    if is_kr:
        payload = _fetch_kr(code)
    elif code in _SELF_HOSTED:
        return False
    else:
        found = get_us_logo(_logo_symbol(code))
        payload = found[0] if found else None

    # False on an unreadable or missing image, not True: leaving a logo alone is the
    # outcome that looks like nothing happened, and plating one that did not need it is
    # the outcome that looks broken.
    return needs_plate(payload) if payload is not None else False


def is_dark(code: str) -> bool:
    code = (code or "").strip()
    if not code:
        return False
    return cache.get_or_set(f"logo_tone:{code}", TTL_SECONDS, lambda: _probe(code))


def dark_codes(codes: list[str]) -> list[str]:
    """The subset of `codes` whose logos are too dark for the dark theme.

    Returns only the dark ones rather than a verdict per code: the client's job is to
    add a class to a few rows, and a list of exceptions is both the smaller payload and
    the smaller thing to reason about.
    """
    seen: set[str] = set()
    dark: list[str] = []
    for code in codes:
        code = (code or "").strip()
        if not code or code in seen:
            continue
        seen.add(code)
        try:
            if is_dark(code):
                dark.append(code)
        except Exception:  # noqa: BLE001 - a cosmetic probe must never fail a request
            log.debug("logo tone probe failed for %s", code, exc_info=True)
    return dark


# Codes a warm-up thread is already working on, so a second request for the same page
# a few seconds later does not queue the same 50 downloads again.
_warming: set[str] = set()
_warming_lock = threading.Lock()


def known_dark(code: str) -> bool:
    """The cached verdict, without fetching anything. Unprobed codes read as False.

    This is what a request path calls. Probing inline would make the first load of a
    roster page wait on fifty logo downloads to decide a background colour — so the
    answer for an unprobed code is "no plate", `warm()` fills the cache behind the
    request, and the flag arrives with the page's next 10-second refresh. A logo that
    is briefly un-plated is a cosmetic delay; a page that takes ten seconds to appear
    is not.
    """
    cached = cache.peek(f"logo_tone:{code}")
    return bool(cached)


def warm(codes: list[str]) -> None:
    """Probe, in the background, whichever of `codes` has never been probed."""
    pending = [c for c in {(c or "").strip() for c in codes} if c and cache.peek(f"logo_tone:{c}") is None]
    if not pending:
        return
    with _warming_lock:
        pending = [c for c in pending if c not in _warming]
        _warming.update(pending)
    if not pending:
        return

    def _run() -> None:
        try:
            for code in pending:
                try:
                    is_dark(code)
                except Exception:  # noqa: BLE001 - cosmetic, never worth surfacing
                    log.debug("logo tone warm failed for %s", code, exc_info=True)
        finally:
            with _warming_lock:
                _warming.difference_update(pending)

    threading.Thread(target=_run, daemon=True).start()
