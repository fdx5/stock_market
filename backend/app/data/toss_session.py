"""Shared session and symbol resolution for Toss Securities' public read endpoints.

Toss keys a listing by two different opaque codes, and which one a given endpoint
wants is not guessable from the endpoint's shape:

  productCode  (AAPL -> "US19801212001")  the *listing*: quotes, the community board
  companyCode  (AAPL -> "NAS000C7F-E0")   the *issuer*: news coverage

Both come back from the same public stock-info lookup, so resolving them together costs
one request instead of two and keeps them from drifting apart in the cache. The
discussion and news fetchers each take the one they need from here rather than
re-deriving it, which is also why this is a module and not a helper inside either
of them.
"""

import logging
import threading
import time
import uuid
from urllib.parse import quote
from dataclasses import dataclass
from email.utils import parsedate_to_datetime

import requests

from app.services.cache import cache
from app.data.http_pool import mount_pool

TTL_CODES_SECONDS = 24 * 60 * 60
INFO_API = "https://wts-info-api.tossinvest.com"
CERT_API = "https://wts-cert-api.tossinvest.com"
PUBLIC_API = "https://wts-api.tossinvest.com"
TOSS_TIMEOUT = (3.05, 8)
MAX_CONCURRENT_REQUESTS = 3
COOLDOWN_SECONDS = 30
MAX_COOLDOWN_SECONDS = 5 * 60
logger = logging.getLogger(__name__)


class TossUnavailable(RuntimeError):
    """Endpoint cooling down or all request slots busy; preserve cached data."""


@dataclass
class _EndpointState:
    failures: int = 0
    retry_at: float = 0
    generation: int = 0
    probing: bool = False


class _RequestGate:
    """Limit bursts and allow only one recovery probe after an endpoint failure.

    Endpoint keys are fixed by our fetchers, never user-supplied ticker/cursor keys.
    A late success from an older concurrent request cannot cancel a newer outage.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._slots = threading.BoundedSemaphore(MAX_CONCURRENT_REQUESTS)
        self._states: dict[str, _EndpointState] = {}

    def begin(self, endpoint: str) -> int:
        with self._lock:
            state = self._states.setdefault(endpoint, _EndpointState())
            if state.retry_at > time.monotonic() or state.probing:
                raise TossUnavailable("Toss endpoint is cooling down")
            if not self._slots.acquire(blocking=False):
                raise TossUnavailable("Toss request slots are busy")
            state.probing = state.failures > 0
            return state.generation

    def finish(self, endpoint: str, generation: int, error: Exception | None, retry_after: float = 0) -> None:
        report = None
        with self._lock:
            state = self._states[endpoint]
            if error is None:
                if generation == state.generation:
                    state.failures = 0
                    state.retry_at = 0
                    state.probing = False
            elif generation == state.generation:
                state.failures += 1
                state.generation += 1
                state.probing = False
                delay = min(MAX_COOLDOWN_SECONDS, max(retry_after, COOLDOWN_SECONDS * 2 ** min(state.failures - 1, 4)))
                state.retry_at = time.monotonic() + delay
                report = (type(error).__name__, delay)
        self._slots.release()
        if report:
            logger.warning("Toss %s unavailable (%s); serving cached data, next probe in %.0fs", endpoint, *report)


_gate = _RequestGate()


def _retry_after(response: requests.Response) -> float:
    value = response.headers.get("Retry-After", "")
    try:
        return max(0, float(value))
    except ValueError:
        try:
            return max(0, parsedate_to_datetime(value).timestamp() - time.time())
        except (ValueError, TypeError, OverflowError):
            return 0

session = requests.Session()
session.headers.update(
    {
        "User-Agent": "Mozilla/5.0 (compatible; KStockHub/1.0)",
        "Accept": "application/json",
        "Origin": "https://www.tossinvest.com",
        "Referer": "https://www.tossinvest.com/",
    }
)
mount_pool(session, max_retries=0)
_public_lock = threading.Lock()
_public_generation = 0


def _init_public_session(observed: int) -> None:
    """Negotiate the same anonymous read session as the public website, in memory.

    This never signs in, uses a member profile or persists cookies/tokens to disk.
    A concurrent failure wave shares one initialization rather than rotating sessions.
    """
    global _public_generation
    with _public_lock:
        if observed != _public_generation: return
        if not any(cookie.name == "deviceId" for cookie in session.cookies):
            session.cookies.set("deviceId", str(uuid.uuid4()), domain=".tossinvest.com", path="/")
        response = session.request("GET", f"{PUBLIC_API}/api/v3/init", timeout=TOSS_TIMEOUT)
        try: response.raise_for_status()
        finally: response.close()
        _public_generation += 1


def request_json(method: str, path: str, *, endpoint: str | None = None,
                 result_type: type = dict, list_field: str | None = None, host: str = "info", **kwargs) -> dict:
    """One bounded read; only explicit anonymous-client negotiation retries once."""
    endpoint = endpoint or path
    generation = _gate.begin(endpoint)
    response = None
    error = None
    retry_after = 0
    invalid_state = False
    public_generation = _public_generation
    try:
        base = CERT_API if host == "cert" else INFO_API
        response = session.request(method, f"{base}{path}", timeout=TOSS_TIMEOUT, **kwargs)
        # This is public client initialization, not an auth retry or an outage retry.
        if response.status_code == 400:
            try: invalid_state = (response.json().get("error") or {}).get("code") == "invalid-client-state"
            except (ValueError, AttributeError): invalid_state = False
            if invalid_state:
                response.close()
                _init_public_session(public_generation)
                response = session.request(method, f"{base}{path}", timeout=TOSS_TIMEOUT, **kwargs)
        retry_after = _retry_after(response)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict) or not isinstance(payload.get("result"), result_type):
            raise ValueError("Toss returned an invalid result")
        if list_field is not None and not isinstance(payload["result"].get(list_field), list):
            raise ValueError(f"Toss returned an invalid {list_field} list")
        return payload
    except Exception as exc:
        # A missing article/listing is specific to that request, not an outage.
        if not (isinstance(exc, requests.HTTPError) and response is not None
                and 400 <= response.status_code < 500 and response.status_code != 429 and not invalid_state):
            error = exc
        raise
    finally:
        try:
            if response is not None:
                response.close()
        finally:
            _gate.finish(endpoint, generation, error, retry_after)


def _resolve_codes(symbol: str) -> dict[str, str | None]:
    try:
        item = request_json("GET", f"/api/v2/stock-infos/code-or-symbol/{quote(symbol, safe='.-')}", endpoint="stock-code-resolution")["result"]
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            return {"product_code": None, "company_code": None}
        raise
    # Never substitute a similarly named ETF or issuer for the exact listing.
    if str(item.get("symbol") or "").upper() == symbol.upper() or item.get("code") == symbol:
        return {"product_code": item.get("code") or item.get("productCode"), "company_code": item.get("companyCode")}
    return {"product_code": None, "company_code": None}


def resolve_codes(symbol: str, *, raise_on_error: bool = False) -> dict[str, str | None]:
    """Both Toss codes for a ticker, or a pair of Nones for one Toss does not list.

    Cached for a day: a listing's codes are assigned once and never change, and the
    lookup is otherwise paid on every board and news request.
    """
    symbol = symbol.upper()
    try:
        return cache.get_or_set(
            f"toss_codes:{symbol}",
            TTL_CODES_SECONDS,
            lambda: _resolve_codes(symbol),
        )
    except Exception:
        if raise_on_error:
            raise
        return {"product_code": None, "company_code": None}


def resolve_product_code(symbol: str, *, raise_on_error: bool = False) -> str | None:
    return resolve_codes(symbol, raise_on_error=raise_on_error)["product_code"]


def resolve_company_code(symbol: str, *, raise_on_error: bool = False) -> str | None:
    return resolve_codes(symbol, raise_on_error=raise_on_error)["company_code"]
