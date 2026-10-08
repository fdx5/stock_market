"""Shared, bounded v7 quote transport for TOP 100, US maps and ETFs.

Failures belong to a host, not to every chunk on every 20-second tick. Both
readers share cooldowns and a single recovery probe. A rejected fresh crumb is
never sent twice; an alternate host can still answer with that credential.
No response bodies, request URLs, cookies or crumbs are logged.
"""
import logging
import threading
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

import requests

from app.data import yahoo_session

logger = logging.getLogger(__name__)
QUOTE_URLS = (
    "https://query1.finance.yahoo.com/v7/finance/quote",
    "https://query2.finance.yahoo.com/v7/finance/quote",
)
TIMEOUT = (3.05, 8)
MAX_CONCURRENT_PER_HOST = 4
BACKOFF_SECONDS = 60
AUTH_BACKOFF_SECONDS = 300
MAX_BACKOFF_SECONDS = 900
THROTTLE_BASE_SECONDS = 900
THROTTLE_MAX_SECONDS = 6 * 3600


class QuoteUnavailable(RuntimeError):
    """A bounded upstream failure or a skipped request during its cooldown."""


@dataclass
class _HostState:
    failures: int = 0
    retry_at: float = 0
    generation: int = 0
    probing: bool = False
    inflight: int = 0


class _QuoteGate:
    def __init__(self):
        self._lock = threading.Lock()
        self._states = {url: _HostState() for url in QUOTE_URLS}

    def begin(self, url: str) -> int:
        with self._lock:
            state = self._states[url]
            if state.retry_at > time.monotonic() or state.probing:
                raise QuoteUnavailable("Yahoo quote host cooling down")
            if state.inflight >= MAX_CONCURRENT_PER_HOST:
                raise QuoteUnavailable("Yahoo quote host request slots busy")
            state.inflight += 1
            state.probing = state.failures > 0
            return state.generation

    def finish(self, url: str, generation: int, reason: str | None,
               status: int | None = None, retry_after: float = 0, *, succeeded: bool = True) -> None:
        report = None
        with self._lock:
            state = self._states[url]
            state.inflight -= 1
            if generation != state.generation:
                return  # An older concurrent success cannot cancel a newer outage.
            state.probing = False
            if reason is None:
                if succeeded:
                    state.failures = 0
                    state.retry_at = 0
            else:
                state.failures += 1
                state.generation += 1
                base = THROTTLE_BASE_SECONDS if status == 429 else AUTH_BACKOFF_SECONDS if status in (401, 403) else BACKOFF_SECONDS
                maximum = THROTTLE_MAX_SECONDS if status == 429 else MAX_BACKOFF_SECONDS
                wait = max(retry_after, min(maximum, base * 2 ** min(state.failures - 1, 5)))
                state.retry_at = time.monotonic() + wait
                report = (reason, status, wait)
        if report:
            logger.info("Yahoo batch host unavailable: host=%s reason=%s status=%s next_probe_s=%.0f",
                        urlsplit(url).hostname, *report)


_gate = _QuoteGate()


def fetch_rows_from(url: str, symbols: list[str], *, allow_refresh: bool = True) -> list[dict]:
    """One host, at most one retry with genuinely replaced authentication."""
    if not symbols:
        return []
    generation = _gate.begin(url)
    response = None
    reason = None
    status = None
    retry_after = 0
    succeeded = False
    try:
        session, crumb = yahoo_session.get_crumb()
        response = session.get(url, params={"symbols": ",".join(symbols), "crumb": crumb}, timeout=TIMEOUT)
        if response.status_code in (401, 403) and allow_refresh:
            status = response.status_code
            reason = "authentication_rejected"
            renewed_session, renewed_crumb = yahoo_session.get_crumb(force_refresh=True)
            # get_crumb intentionally reuses a credential younger than 30 seconds.
            # Sending that same rejected pair again cannot repair authorization.
            if renewed_session is not session or renewed_crumb != crumb:
                response.close()
                response = None
                status = None
                response = renewed_session.get(url, params={"symbols": ",".join(symbols), "crumb": renewed_crumb}, timeout=TIMEOUT)
            reason = None
        status = response.status_code
        retry_after = yahoo_session._retry_after_seconds(response) or 0
        response.raise_for_status()
        payload = response.json()
        envelope = payload.get("quoteResponse") if isinstance(payload, dict) else None
        if not isinstance(envelope, dict) or envelope.get("error") or not isinstance(envelope.get("result"), list):
            raise ValueError("Yahoo returned an invalid quote result")
        succeeded = True
        return [row for row in envelope["result"] if isinstance(row, dict)]
    except yahoo_session.CrumbUnavailable:
        # The shared handshake has its own cooldown. A rejection already received
        # from this quote host still counts, but a skipped handshake does not.
        raise
    except requests.HTTPError:
        if status in (401, 403, 429) or status is not None and status >= 500:
            reason = "authentication_rejected" if status in (401, 403) else "rate_limited" if status == 429 else "server_error"
        raise QuoteUnavailable("Yahoo quote HTTP request failed") from None
    except requests.RequestException as error:
        reason = "read_timeout" if isinstance(error, requests.ReadTimeout) else "invalid_payload" if isinstance(error, requests.exceptions.JSONDecodeError) else "transport_error"
        raise QuoteUnavailable("Yahoo quote transport unavailable") from None
    except (ValueError, TypeError):
        reason = "invalid_payload"
        raise QuoteUnavailable("Yahoo quote payload unavailable") from None
    finally:
        try:
            if response is not None:
                response.close()
        finally:
            _gate.finish(url, generation, reason, status, retry_after, succeeded=succeeded)


def fetch_rows(symbols: list[str]) -> list[dict]:
    for url in QUOTE_URLS:
        try:
            rows = fetch_rows_from(url, symbols)
            if rows:
                return rows
        except QuoteUnavailable:
            continue
    return []
