"""08:00/16:00 KST videos and daily portfolios, with immutable snapshot files.

No SQL, replacement, retention or deletion. Failed providers retain prior editions.
Only server-side public market data is saved; requests cannot choose file paths.
"""
import datetime as dt
import json
import logging
import math
import os
from pathlib import Path
import threading
import time
from uuid import uuid4

from app.data import editorial_sources as source, us_live_quotes

logger = logging.getLogger(__name__)
KINDS = ("videos-kr", "videos-us", "investors")
DATA_DIR = Path(os.environ.get("EDITORIAL_DATA_DIR") or Path(__file__).resolve().parents[1] / "data" / "store" / "editorial")
SEED_DIR = Path(__file__).resolve().parents[1] / "data" / "editorial_seed"
BUNDLED_DIR = Path(__file__).resolve().parents[1] / "data" / "editorial_editions"
_lock = threading.Lock()
_snapshots: dict[str, dict] = {}
_running: set[str] = set()
_attempted: dict[str, float] = {}
_attempted_editions: dict[str, str] = {}
_failures: dict[str, dict] = {}
_loaded: set[str] = set()
_stop = threading.Event()
_started = False


def _window(kind: str) -> tuple[dt.datetime, dt.datetime]:
    return source.edition_window() if kind == "investors" else source.video_edition_window()


def _snapshot_key(payload: dict) -> tuple[str, dt.datetime, int, str]:
    # Old daily snapshots are morning editions, even if collected after 16:00.
    end = source._iso(payload.get("window_end", ""))
    if end is None:
        end = dt.datetime.fromisoformat(payload.get("edition") or "0001-01-01").replace(hour=8, tzinfo=source.KST)
    # Collector networks can see different candidate subsets. A partial retry
    # must not displace a fuller verified list from the very same slot.
    coverage = min(20, len(payload.get("items", []))) if payload.get("market") in ("kr", "us") else 0
    return payload.get("edition", ""), end, coverage, payload.get("collected_at", "")


def _load(kind: str) -> None:
    with _lock:
        if kind in _loaded: return
        candidates = []
        groups = (sorted(DATA_DIR.glob(kind + "-*.json"), reverse=True),
                  sorted(BUNDLED_DIR.glob(kind + "-*.json"), reverse=True), [SEED_DIR / (kind + ".json")])
        for paths in groups:
            for path in paths:
                try:
                    payload = json.loads(path.read_text(encoding="utf-8"))
                    if payload.get("items") and payload.get("edition"):
                        candidates.append(payload)
                except (OSError, ValueError, TypeError):
                    continue
        if candidates:
            latest = max(candidates, key=_snapshot_key)
            _snapshots.setdefault(kind, latest)
        _loaded.add(kind)


def _save(kind: str, payload: dict) -> None:
    if kind not in KINDS or not payload.get("items"):
        raise ValueError("Invalid editorial snapshot")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now(source.UTC).strftime("%Y%m%dT%H%M%S%f")
    # Exclusive creation: an existing saved edition is never overwritten.
    with (DATA_DIR / f"{kind}-{stamp}-{uuid4().hex[:8]}.json").open("x", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, allow_nan=False)


def _collect_investors(previous: dict | None) -> dict:
    from concurrent.futures import ThreadPoolExecutor, as_completed
    by_id = {item["id"]: item for item in (previous or {}).get("items", [])}
    healthy = 0
    _, cutoff = source.edition_window()
    edition = cutoff.date().isoformat()
    pending = [profile for profile in source.INVESTORS if by_id.get(profile["id"], {}).get("edition") != edition
               or profile.get("coverage_version") and by_id.get(profile["id"], {}).get("coverage_version") != profile["coverage_version"]]
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {pool.submit(source.fetch_portfolio, profile): profile for profile in pending}
        for future in as_completed(futures):
            profile = futures[future]
            try:
                data = future.result()
                old = by_id.get(profile["id"], {})
                by_id[profile["id"]] = {**old, **data, "edition": edition}
                healthy += 1
            except Exception as exc:
                logger.info("Editorial portfolio source unavailable: investor=%s type=%s", profile["id"], type(exc).__name__)
    if not healthy and pending:
        raise RuntimeError("No portfolio sources answered")
    complete = all(by_id.get(profile["id"], {}).get("edition") == edition for profile in source.INVESTORS)
    return {"edition": edition, "collected_at": dt.datetime.now(source.UTC).isoformat(), "complete": complete,
            "items": [by_id[p["id"]] for p in source.INVESTORS if p["id"] in by_id], "sources_refreshed": healthy}


def _refresh(kind: str) -> None:
    try:
        with _lock: previous = _snapshots.get(kind)
        payload = _collect_investors(previous) if kind == "investors" else source.fetch_videos(kind.split("-")[1])
        _save(kind, payload)
        with _lock:
            current = _snapshots.get(kind, {})
            if _snapshot_key(payload) >= _snapshot_key(current):
                _snapshots[kind] = payload
                _failures.pop(kind, None)
    except Exception as exc:
        with _lock:
            _failures[kind] = {"code": "source_unavailable", "failed_at": dt.datetime.now(source.UTC).isoformat(),
                               **getattr(exc, "diagnostics", {})}
        logger.info("Editorial refresh retained prior snapshot: kind=%s type=%s", kind, type(exc).__name__)
    finally:
        with _lock: _running.discard(kind)


def ensure(kind: str) -> None:
    if kind not in KINDS: raise ValueError("Unknown editorial kind")
    _load(kind)
    _, cutoff = _window(kind)
    with _lock:
        current = _snapshots.get(kind, {})
        by_id = {row["id"]: row for row in current.get("items", [])}
        roster_complete = kind != "investors" or all(profile["id"] in by_id and (
            not profile.get("coverage_version") or by_id[profile["id"]].get("coverage_version") == profile["coverage_version"]
        ) for profile in source.INVESTORS)
        current_slot = kind == "investors" or _snapshot_key(current)[1] == cutoff
        if (current.get("edition") == cutoff.date().isoformat() and current_slot and current.get("complete", True) and roster_complete) or kind in _running:
            return
        now = time.monotonic()
        edition = cutoff.isoformat()
        if (_attempted_editions.get(kind) == edition and kind in _attempted
                and now - _attempted[kind] < 60): return
        _attempted[kind] = now
        _attempted_editions[kind] = edition
        _running.add(kind)
    threading.Thread(target=_refresh, args=(kind,), name="editorial-" + kind, daemon=True).start()


def _status(kind: str, payload: dict | None) -> dict:
    _, cutoff = _window(kind)
    next_update = ((cutoff + dt.timedelta(days=1)).replace(hour=8)
                   if kind == "investors" or cutoff.hour == 16 else cutoff.replace(hour=16))
    with _lock:
        refreshing = kind in _running
        failure = _failures.get(kind)
    return {"status": "ready" if payload else "loading" if refreshing else "unavailable", "refreshing": refreshing,
            "stale": bool(payload and (payload.get("edition") != cutoff.date().isoformat()
                                       or kind != "investors" and _snapshot_key(payload)[1] != cutoff)),
            "last_refresh_error": failure, "next_update_at": next_update.isoformat()}


def accept_video_edition(market: str, payload: dict) -> dict:
    """Authenticated collector handoff; only append verified public video editions."""
    start, cutoff = source.video_edition_window()
    if market not in ("kr", "us") or payload.get("market") != market or payload.get("edition") != cutoff.date().isoformat():
        raise ValueError("Collector edition does not match the current KST video window")
    if source._iso(payload.get("window_start", "")) != start or source._iso(payload.get("window_end", "")) != cutoff:
        raise ValueError("Collector publication window does not match the current 08:00/16:00 KST slot")
    rows = payload.get("items", [])
    items = source.rank_videos(rows, market, start, cutoff)
    if not items or len(items) != len(rows):
        raise ValueError("Collector videos failed publication, market or ranking validation")
    collected = source._iso(payload.get("collected_at", ""))
    now = dt.datetime.now(source.UTC)
    if collected is None or not cutoff <= collected <= now + dt.timedelta(minutes=5):
        raise ValueError("Invalid collection timestamp")
    kind = "videos-" + market
    _load(kind)
    clean = {"market": market, "edition": cutoff.date().isoformat(), "window_start": start.isoformat(),
             "window_end": cutoff.isoformat(), "collected_at": collected.isoformat(), "source": "youtube_external_collector",
             "candidate_count": max(len(items), int(payload.get("candidate_count", len(items)))),
             "ranking_basis": "views_among_discovered_candidates", "items": items}
    with _lock:
        current = _snapshots.get(kind, {})
        # A delayed CI job must not displace a newer successful collection.
        if _snapshot_key(current) >= _snapshot_key(clean):
            return {"status": "already_current", "edition": current["edition"]}
        _save(kind, clean)
        _snapshots[kind] = clean
        _failures.pop(kind, None)
    return {"status": "saved", "edition": clean["edition"], "count": len(items)}


def get_videos(market: str) -> dict:
    kind = "videos-" + market
    ensure(kind)
    with _lock: payload = _snapshots.get(kind)
    start, cutoff = source.video_edition_window()
    return {"market": market, "items": [], "edition": None, "window_start": start.isoformat(), "window_end": cutoff.isoformat(),
            **(payload or {}), **_status(kind, payload)}


def _profile(data: dict, profile: dict) -> dict:
    if profile.get("coverage_version") and data.get("coverage_version") != profile["coverage_version"]:
        data = {}  # Preserve the saved snapshot, but never present the old narrower scope as complete.
    holdings = data.get("holdings", [])
    total = sum(row.get("weight_pct", 0) for row in holdings)
    return {**profile, **{key: value for key, value in data.items() if key not in ("holdings", "exited_holdings")}, **source.fetch_portrait(profile),
            "holding_count": len(holdings), "top3_weight": round(sum(row["weight_pct"] for row in holdings[:3]), 2),
            "new_count": sum(row["activity"] == "new" for row in holdings), "add_count": sum(row["activity"] == "add" for row in holdings),
            "exit_count": len(data.get("exited_holdings", [])), "equity_coverage_pct": round(total, 2), "top_holdings": holdings[:3], "available": bool(holdings)}


def get_investors() -> dict:
    ensure("investors")
    with _lock: payload = _snapshots.get("investors")
    data = {row["id"]: row for row in (payload or {}).get("items", [])}
    items = [_profile(data.get(profile["id"], {}), profile) for profile in source.INVESTORS]
    latest_report = max((row.get("report_date", "") for row in data.values() if row.get("data_basis") != "daily_fund"), default="")
    consensus_period = next((row.get("period") for row in data.values() if row.get("report_date") == latest_report), None)
    shared: dict[str, dict] = {}
    for profile in source.INVESTORS:
        disclosed = data.get(profile["id"], {})
        if disclosed.get("report_date") != latest_report or disclosed.get("data_basis") == "daily_fund":
            continue
        for row in disclosed.get("holdings", []):
            if not row.get("code") or row.get("asset_type", "equity") not in ("equity", "preferred"):
                continue
            bucket = shared.setdefault(row["code"], {"code": row["code"], "name": row["name"], "investors": [], "max_weight": 0})
            if profile["id"] in bucket["investors"]:
                continue
            bucket["investors"].append(profile["id"])
            bucket["max_weight"] = max(bucket["max_weight"], row["weight_pct"])
    consensus = sorted((dict(row, count=len(row["investors"])) for row in shared.values() if len(row["investors"]) >= 2), key=lambda row: (-row["count"], -row["max_weight"], row["code"]))[:12]
    return {"items": items, "consensus": consensus, "consensus_period": consensus_period, "edition": (payload or {}).get("edition"), "collected_at": (payload or {}).get("collected_at"),
            "available_count": sum(row["available"] for row in items), **_status("investors", payload)}


def get_portfolio(investor_id: str) -> dict | None:
    profile = next((row for row in source.INVESTORS if row["id"] == investor_id), None)
    if profile is None: return None
    ensure("investors")
    with _lock: payload = _snapshots.get("investors")
    data = next((row for row in (payload or {}).get("items", []) if row["id"] == investor_id), {})
    if profile.get("coverage_version") and data.get("coverage_version") != profile["coverage_version"]:
        data = {}
    holdings = data.get("holdings", [])
    exited = data.get("exited_holdings", [])
    codes = list({row["code"] for row in holdings + exited if row.get("code")})
    # Existing public quote recovery is shared across maps, investors and detail views.
    us_live_quotes.recover_missing(codes)
    quotes = us_live_quotes.latest(codes)
    def enrich(row):
        quote = quotes.get(row["code"], {})
        def valid(value):
            return value if isinstance(value, (int, float)) and math.isfinite(value) and value > 0 else None
        price = valid(quote.get("close")) or valid(row.get("snapshot_price"))
        derivative = row.get("asset_type") in ("put", "call", "bond")
        reference = valid(row.get("reference_price"))
        return {**row, "current_price": None if derivative else price, "underlying_price": price if derivative else None, "quote_time": quote.get("quote_time"),
                         "price_source": quote.get("quote_source") or "daily_snapshot", "session": quote.get("session"),
                         "daily_change_pct": quote.get("change_pct") if price and not derivative else None,
                         "reference_return_pct": round((price / reference - 1) * 100, 2) if price and reference and not derivative else None,
                         "current_value": price * row["shares"] if price and not derivative else None}
    enriched = [enrich(row) for row in holdings]
    total = sum(row["current_value"] or 0 for row in enriched)
    complete = bool(enriched) and all(row["current_value"] is not None for row in enriched)
    # Daily funds can include private/no-ticker assets. A partial public-stock
    # subset must never be normalized to look like the entire fund.
    complete = complete and sum(row.get("weight_pct", 0) for row in enriched) >= 99
    for row in enriched:
        row["current_weight_pct"] = round(row["current_value"] / total * 100, 2) if complete and total else None
    return {"investor": _profile(data, profile), "holdings": enriched, "exited_holdings": [enrich(row) for row in exited], "estimated_equity_value": total if complete else None, "valuation_complete": complete,
            "purchase_price_disclosed": False, "return_basis": "quarter_end_reference_excluding_dividends_and_subsequent_trades",
            "edition": data.get("edition", (payload or {}).get("edition")), "collected_at": data.get("collected_at"),
            **_status("investors", {**data, "edition": data.get("edition", (payload or {}).get("edition"))} if holdings else None)}


def start_scheduler() -> None:
    global _started
    with _lock:
        if _started: return
        _started = True
    _stop.clear()
    def loop():
        while not _stop.is_set():
            for kind in KINDS:
                try: ensure(kind)
                except Exception as exc: logger.info("Editorial scheduling failed: type=%s", type(exc).__name__)
            _stop.wait(30)
    threading.Thread(target=loop, name="editorial-kst", daemon=True).start()


def stop_scheduler() -> None:
    _stop.set()
